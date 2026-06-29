# RBAC Permission Matrix (v1.0.0)

Generated from RolesGuard (apps/api/src/modules/auth/rbac/) and per-controller decorators.

## Role hierarchy

```
OWNER (3)  >  ADMIN (2)  >  MANAGER (1)  >  MEMBER (0)  >  VIEWER (read-only)
```

## Endpoint permission matrix

(Exhaustive mapping — `X` = allowed, blank = denied)

| Endpoint | OWNER | ADMIN | MANAGER | MEMBER | VIEWER |
|---|---|---|---|---|---|
| `POST /auth/login` | X | X | X | X | X |
| `POST /auth/signup` | X | X | X | X | X |
| `POST /auth/onboarding/complete` | X | X | X | X | X |
| `POST /tenants` | X | X | X | | |
| `PATCH /tenants/:id` | X | X |  |  |  |
| `DELETE /tenants/:id` | X |  |  |  |  |
| `POST /tenants/:id/switch` | X | X | X | X |  |
| `GET /projects` | X | X | X | X | X |
| `POST /projects` | X | X | X | X |  |
| `PATCH /projects/:id` | X | X | X |  |  |
| `DELETE /projects/:id` | X | X |  |  |  |
| `POST /projects/:id/tasks` | X | X | X | X |  |
| `PATCH /projects/:id/tasks/:tid` | X | X | X |  |  |
| `DELETE /projects/:id/tasks/:tid` | X | X | X |  |  |
| `GET /docs/templates` | X | X | X | X | X |
| `POST /docs/templates` | X | X |  |  |  |
| `PATCH /docs/templates/:id` | X | X |  |  |  |
| `DELETE /docs/templates/:id` | X | X |  |  |  |
| `POST /docs/templates/:id/render` | X | X | X | X | X |
| `GET /bi/dashboards` | X | X | X | X | X |
| `POST /bi/dashboards` | X | X | X | X |  |
| `GET /audit-logs` | X | X |  |  |  |
| `POST /files/presign` | X | X | X | X |  |
| `POST /files/:id/finalize` | X | X | X | X |  |
| `GET /files/:id` | X | X | X | X |  |
| `DELETE /files/:id` | X | X |  |  |  |
| `GET /mail/templates` | X | X | X | X | X |
| `POST /mail/templates` | X | X | X |  |  |
| `POST /mail/send` | X | X | X | X |  |
| `GET /chat/channels` | X | X | X | X | X |
| `POST /chat/channels/:id/messages` | X | X | X | X |  |

## Tenant rules (every endpoint above)

- All `/api/*` endpoints require JWT auth
- All queries filtered by `tenantId` from AsyncLocalStorage (defense in depth)
- Cross-tenant access returns 404 (not 403, to avoid leaking existence)
