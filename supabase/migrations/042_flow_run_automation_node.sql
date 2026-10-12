-- ============================================================
-- 042_flow_run_automation_node.sql
--
-- Flows can run automations: add the 'run_automation' node type.
-- (Automations start flows via the 'start_flow' step; automation_steps
-- has no step_type CHECK, so that side needs no migration.)
-- Idempotent.
-- ============================================================

ALTER TABLE flow_nodes
  DROP CONSTRAINT IF EXISTS flow_nodes_node_type_check;

ALTER TABLE flow_nodes
  ADD CONSTRAINT flow_nodes_node_type_check
  CHECK (node_type IN (
    'start',
    'send_buttons',
    'send_list',
    'send_message',
    'send_media',
    'collect_input',
    'condition',
    'set_tag',
    'handoff',
    'http_fetch',
    'run_automation',
    'end'
  ));
