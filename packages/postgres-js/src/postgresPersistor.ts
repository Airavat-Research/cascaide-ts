import postgres, { Sql } from 'postgres';
import { randomUUID } from 'crypto';
import {
  CascadePersistence,
} from '@cascaide-ts/core';

import { ClaimRequest, ClaimResponse, WorkflowContext } from '@cascaide-ts/core';

const isDev = process.env.NODE_ENV === 'development';

// Helper function for dev-only logging
const devLog = (...args: any[]) => {
  if (isDev) console.log(...args);
};

const devError = (...args: any[]) => {
  if (isDev) console.error(...args);
};

export class PostgresPersistor implements CascadePersistence {
  constructor(private sql: postgres.Sql<{}>) {}

  async claimNodeExecution(params: ClaimRequest): Promise<ClaimResponse> {
    const startTime = performance.now();
    const {
      nodeInstanceId,
      cascadeId,
      userId,
      nodeName,
      functionId: requestedId,
      inputContext,
      location,
    } = params;

    devLog('Claiming node execution:', { cascadeId, nodeName, requestedId });

    // Generate UUID in application instead of database for better performance
    const executionId = randomUUID();

    const result = await this.sql.begin(async (sql: any) => {
      const result = await sql`
        WITH conflict_check AS (
          -- Single aggregation combining conflict detection and MAX calculation
          -- More efficient than separate EXISTS and MAX queries
          SELECT 
            CASE 
              WHEN COUNT(*) FILTER (WHERE function_id = ${requestedId}) > 0 
              THEN MAX(function_id) + 1
              ELSE ${requestedId}
            END as next_fn_id
          FROM node_executions 
          WHERE cascade_id = ${cascadeId}
        ),
        cascade_upsert AS (
          INSERT INTO cascades (id, user_id, status, fn_id, created_at, updated_at)
          SELECT ${cascadeId}, ${userId}, 'RUNNING', next_fn_id, NOW(), NOW()
          FROM conflict_check
          ON CONFLICT (id) DO UPDATE 
            SET fn_id = EXCLUDED.fn_id, updated_at = NOW()
          RETURNING fn_id
        )
        INSERT INTO node_executions (
          id, 
          node_instance_id, 
          cascade_id, 
          node_name, 
          function_id, 
          input_context, 
          location, 
          status, 
          started_at
        )
        SELECT 
          ${executionId}, 
          ${nodeInstanceId}, 
          ${cascadeId}, 
          ${nodeName}, 
          fn_id, 
          ${this.sql.json(inputContext)}, 
          ${location}, 
          'RUNNING', 
          NOW()
        FROM cascade_upsert
        RETURNING status, function_id as "functionId"
      `;

      return {
        status: result[0].status,
        functionId: Number(result[0].functionId),
      };
    });

    const latency = performance.now() - startTime;

    return result;
  }

  async finalizeNodeExecution(params: {
    nodeInstanceId: string;
    cascadeId: string;
    fullOutput: any;
    hasSpawns: boolean;
  }): Promise<{ status: string }> {
    const startTime = performance.now();
    const { nodeInstanceId, cascadeId, fullOutput, hasSpawns } = params;

    const result = await this.sql.begin(async (sql: any) => {
      // Combine both UPDATEs into a single query using CTE for better performance
      await sql`
        WITH updated_node AS (
          UPDATE node_executions
          SET 
            status = 'COMPLETED',
            full_output = ${this.sql.json(fullOutput)},
            completed_at = NOW()
          WHERE node_instance_id = ${nodeInstanceId}
          RETURNING cascade_id
        )
        UPDATE cascades
        SET status = 'COMPLETED', updated_at = NOW()
        WHERE id IN (SELECT cascade_id FROM updated_node)
          AND ${!hasSpawns}
      `;

      return { status: 'COMPLETED' };
    });

   
    return result;
  }

  async markExecutionFailed(
    nodeInstanceId: string,
    cascadeId: string,
    error: string
  ): Promise<{ status: string }> {
    const startTime = performance.now();

    const result = await this.sql.begin(async (sql: any) => {
      // CRITICAL FIX: Use sql parameter instead of this.sql to maintain transaction semantics
      // Combine both UPDATEs into single query for better performance
      await sql`
        WITH updated_node AS (
          UPDATE node_executions
          SET status = 'FAILED', error = ${error}, completed_at = NOW()
          WHERE node_instance_id = ${nodeInstanceId}
          RETURNING cascade_id
        )
        UPDATE cascades
        SET status = 'ERROR', updated_at = NOW()
        WHERE id IN (SELECT cascade_id FROM updated_node)
      `;

      return { status: 'FAILED' };
    });

    return result;
  }

  async recordContextEvents(params: {
    cascadeId: string;
    functionId: number;
    updates: { [key: string]: any };
    uiUpdates?: { [key: string]: any };   // ADD
  }): Promise<{ status: string }> {
    const startTime = performance.now();
    const { cascadeId, functionId, updates, uiUpdates } = params;

    const events = Object.entries(updates).map(([key, value]) => {
      const uiValue = uiUpdates?.[key];
      return {
        key,
        value: this.sql.json(value),
        // only write ui_value column when it differs from value
        ui_value: uiValue !== undefined ? this.sql.json(uiValue) : null,
        function_id: functionId,
        cascade_id: cascadeId,
        created_at: new Date(),
      };
    });
  

    if (events.length === 0) {
      return { status: 'SUCCESS' };
    }

    await this.sql`
      INSERT INTO context_events ${this.sql(events, 'key', 'value', 'ui_value', 'function_id', 'cascade_id', 'created_at')}
    `;

    return { status: 'SUCCESS' };
  }

  async hydrateCascadeContext(
    cascadeId: string,
    upToFunctionId: number,
    ui?: boolean
  ): Promise<WorkflowContext> {
    const startTime = performance.now();

    // 1. Define the value selector logic based on the UI flag
    // If ui is true: Use ui_value if it exists, otherwise use value.
    // If ui is false: Just use the standard value.
    // 1. Define your conditional column
    let events;

    if (ui) {
      // Query version with COALESCE for UI-specific values
      events = await this.sql`
        SELECT 
          key, 
          COALESCE(ui_value, value) AS value, 
          function_id, 
          created_at
        FROM context_events
        WHERE cascade_id = ${cascadeId}
          AND function_id < ${upToFunctionId}
        ORDER BY function_id ASC, created_at ASC
      `;
    } else {
      // Standard query version
      events = await this.sql`
        SELECT 
          key, 
          value, 
          function_id, 
          created_at
        FROM context_events
        WHERE cascade_id = ${cascadeId}
          AND function_id < ${upToFunctionId}
        ORDER BY function_id ASC, created_at ASC
      `;
    }
    const context: WorkflowContext = {};

    for (const event of events) {
      const key = event.key;
      const val = event.value; // This is now the "resolved" value from the SQL query

      if (!context[key]) {
        context[key] = [];
      }

      // Handle indexed values for sparse array reconstruction
      if (typeof val === 'object' && val !== null && !Array.isArray(val) && 'index' in val) {
        const index = val.index as number;
        context[key][index] = val;
      } else {
        context[key].push(val);
      }
    }

 

    return context;
  }


  async forkCascadeWithContext(params: {
    sourceCascadeId: string;
    newCascadeId: string;
    upToFunctionId: number;
  }): Promise<{ newCascadeId: string; status: string; context: WorkflowContext }> {
    const startTime = performance.now();
    const { sourceCascadeId, newCascadeId, upToFunctionId } = params;
  
    const copiedEvents = await this.sql.begin(async (sql: any) => {
      // 1. Fork the cascade row
      await sql`
        INSERT INTO cascades (id, user_id, status, fn_id, created_at, updated_at)
        SELECT
          ${newCascadeId},
          user_id,
          'RUNNING',
          ${upToFunctionId - 1},
          NOW(),
          NOW()
        FROM cascades
        WHERE id = ${sourceCascadeId}
      `;
  
      // 2. Copy node_executions up to (not including) upToFunctionId
      await sql`
        INSERT INTO node_executions (
          id, node_instance_id, cascade_id, node_name, function_id,
          input_context, location, status, started_at, completed_at, full_output, error
        )
        SELECT
          gen_random_uuid(), gen_random_uuid(), ${newCascadeId},
          node_name, function_id, input_context, location, status,
          started_at, completed_at, full_output, error
        FROM node_executions
        WHERE cascade_id = ${sourceCascadeId}
          AND function_id < ${upToFunctionId}
      `;
  
      // 3. Copy context_events, remapping the key at DB level, and return in one shot
      const events = await sql`
        INSERT INTO context_events (key, value, function_id, cascade_id, created_at)
        SELECT
          CASE WHEN key = ${sourceCascadeId} THEN ${newCascadeId} ELSE key END,
          value,
          function_id,
          ${newCascadeId},
          created_at
        FROM context_events
        WHERE cascade_id = ${sourceCascadeId}
          AND function_id < ${upToFunctionId}
        RETURNING key, value, function_id, created_at
      `;
  
      return events;
    });
  
    // Reconstruct WorkflowContext — keys are already remapped so no conditional needed
    const context: WorkflowContext = {};
    for (const event of copiedEvents) {
      const { key, value } = event;
      if (!context[key]) context[key] = [];
  
      if (typeof value === 'object' && value !== null && !Array.isArray(value) && 'index' in value) {
        context[key][value.index as number] = value;
      } else {
        context[key].push(value);
      }
    }
  
  
    return { newCascadeId, status: 'SUCCESS', context };
  }
}