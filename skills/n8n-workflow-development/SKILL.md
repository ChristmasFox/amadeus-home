---
name: n8n-workflow-development
description: Create, review, or migrate versioned n8n workflows and their integration contracts.
---

# n8n Workflow Development

- Edit the JSON source under `integrations/n8n/workflows/`; do not treat an online n8n instance as the source of truth.
- Before changing a live workflow, export the current workflow JSON, compare it with Git, and preserve a rollback copy. After changing it, export the final workflow back to Git.
- Keep credentials, tokens, passwords, execution data, and database files out of JSON. Use credential placeholders and document the credential name/contract only.
- Validate JSON syntax and the affected runtime gateway/tests. Check webhook paths, Data Table names, result contracts, and n8n credential bindings explicitly.
- Update status docs and a checkpoint with workflow names, import/export result, and remaining manual credential steps.
