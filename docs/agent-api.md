# Local agent API (v1)

The local agent scans a project directory that the user selected and serves normalized analysis results over HTTP on a loopback address. Source code stays on the machine. Responses contain the [`AppProject`](../packages/model/src/types.ts) model, not the codebase, and a single file's text is returned only when the user opens it in the code viewer.

- Implementation: [`packages/agent/src/server.ts`](../packages/agent/src/server.ts)
- Request schemas (zod): [`packages/agent/src/schemas.ts`](../packages/agent/src/schemas.ts)
- Tests: [`packages/agent/src/server.test.ts`](../packages/agent/src/server.test.ts)

## Starting the agent

| Context | How it starts | Who holds the token |
| --- | --- | --- |
| Desktop app | Main process forks `out/main/agent.js` as an Electron utility process | Main process only; the renderer calls the agent through IPC (`agent:request`) |
| Standalone (for a web frontend) | `node apps/desktop/out/main/agent.js [--port 4517] [--allow-origin http://localhost:5173]` after `npm run build` | Printed once on stdout as `{"url":"http://127.0.0.1:4517","token":"…"}` |

Programmatic use: `import { startAgent } from '@appflow/agent'` with `{ port, token, allowedOrigins, adapters, runner }`.

## Security model

| Rule | Behavior |
| --- | --- |
| Loopback only | Binds to `127.0.0.1` (or `localhost`, `::1`); any other host is refused at startup |
| Authentication | Every route except `GET /v1/health` needs `Authorization: Bearer <token>`. The token is compared in constant time |
| DNS rebinding | The `Host` header must be the loopback address and port, otherwise `421` |
| Browser origins | Requests with an `Origin` header are refused (`403`) unless the origin is in `allowedOrigins`. The desktop app needs none |
| Directory scope | A project is registered by absolute path. Drive roots and the home directory itself are refused. File reads are resolved through the real path and cannot leave the project, including through `..` or symlinks |
| Sensitive files | `.env*`, keystores (`.jks`, `.keystore`, `.p12`, …), provisioning profiles, `key.properties`, `local.properties`, `google-services.json`, `GoogleService-Info.plist`, credential files, and similar are never read. They are only counted |
| Excluded folders | `node_modules`, `build`, `.git`, `.dart_tool`, `.gradle`, `Pods`, `DerivedData`, … are not scanned. Symlinked directories are skipped |
| Executing code | Analysis never runs project code. Project tooling (dependency install, builds) runs only through the two-step confirmation flow below, without a shell |
| Limits | JSON request bodies ≤ 64 KB. File previews ≤ 1 MB. Binary files are refused |

## Errors

Every error has the same shape:

```json
{ "error": { "code": "invalid_request", "message": "Request validation failed.", "details": [{ "path": "path", "message": "Required" }] } }
```

| Status | `code` | When |
| --- | --- | --- |
| 400 | `invalid_request` | Schema validation failed, invalid JSON, or a relative or missing path |
| 401 | `unauthorized` | Missing or wrong bearer token |
| 403 | `forbidden` | Path outside the project, sensitive file, origin not allowed, invalid confirmation token |
| 404 | `not_found` | Unknown route, project, analysis, operation, or file |
| 405 | `method_not_allowed` | Known path, wrong method |
| 409 | `conflict` | Result or warnings requested before the analysis succeeded |
| 413 | `payload_too_large` | Body or file over the limit |
| 415 | `unsupported_media_type` | Body is not JSON, or the file is binary |
| 421 | `misdirected_request` | Foreign `Host` header |
| 428 | `confirmation_required` | Operation needs user confirmation (see below) |

## Endpoints

### Health and capabilities

| Method & path | Response |
| --- | --- |
| `GET /v1/health` (no auth) | `{ "status": "ok", "version": "0.1.0" }` |
| `GET /v1/adapters` | `{ "adapters": [{ id, name, platform, capabilities: [{ kind, description, confidence }], limitations: [{ description }] }] }` |

### Projects

| Method & path | Body | Response |
| --- | --- | --- |
| `POST /v1/projects` | `{ "path": "/abs/path" }` | `201` (or `200` if already registered) `{ project: ProjectInfo }` |
| `GET /v1/projects` | — | `{ projects: ProjectInfo[] }` |
| `GET /v1/projects/:id` | — | `{ project: ProjectInfo }` |
| `DELETE /v1/projects/:id` | — | `204`. Cancels the project's running analyses |

`ProjectInfo`: `{ id, name, rootPath, registeredAt, frameworks: [{ id, name, version?, root }] }`. Detection runs during registration. The id is a hash of the real path, so registering the same folder again returns the same id.

### Analyses

| Method & path | Body | Response |
| --- | --- | --- |
| `POST /v1/projects/:id/analyses` | `{ "adapters"?: ["android"] }` | `202 { analysis: AnalysisInfo }`. While one is queued or running, the same job is returned |
| `GET /v1/analyses/:id` | — | `{ analysis: AnalysisInfo }`. Poll this for progress |
| `POST /v1/analyses/:id/cancel` | — | `202 { analysis }`. The status becomes `cancelled` |
| `GET /v1/analyses/:id/result` | — | `{ project: AppProject }`, or `409` until the analysis has `succeeded` |
| `GET /v1/analyses/:id/warnings` | — | `{ warnings: AnalysisWarning[] }` |

`AnalysisInfo`:

```json
{
  "id": "…", "projectId": "…",
  "status": "queued | running | succeeded | failed | cancelled",
  "progress": { "phase": "scanning | detecting | analyzing | assembling | done", "message": "Android (Kotlin / Java): parsing Kotlin/Java (50/120)", "percent": 47 },
  "createdAt": "…", "startedAt": "…", "finishedAt": "…",
  "error": { "message": "…" },
  "summary": { "screens": 14, "edges": 17, "routes": 7, "warnings": 3, "files": 22 }
}
```

### Source changes

| Method & path | Body | Response |
| --- | --- | --- |
| `GET /v1/projects/:id/changes` | — | `{ analysisId, since, changed, counts: { added, removed, modified }, added[], removed[], modified[] }`, or `409` before the first analysis |

The agent rescans the project and compares the result with the file list recorded when the latest analysis started (size and modification time). If a file's time changed but its size did not, its content is hashed and compared with the analyzed `contentHash`, so touching a file or checking out the same content does not count as an edit. The response contains relative paths only, at most 50 of each kind, and never file contents. Sensitive and ignored files are not scanned, so they never appear. The desktop app polls this endpoint every 15 seconds while the window is visible, and again when the window gains focus.

An adapter that crashes does not fail the analysis. The adapter is reported in `project.adapters` with `status: "failed"`, together with an `adapter-failed` warning, and the other adapters' results are returned.

### Files

| Method & path | Body | Response |
| --- | --- | --- |
| `GET /v1/projects/:id/files/content?path=lib/main.dart` | — | `{ path, language, content, hash }`. `hash` is the SHA-1 of `content`; compare it with the file's `contentHash` in the analysis result to detect edits made after the analysis |
| `POST /v1/projects/:id/files/reveal` | `{ "path": "lib/main.dart" }` | `{ path, absolutePath }`, the real path for opening in a local editor. Same rules as reading: inside the project after resolving symlinks, not sensitive, a regular file (otherwise `403` or `404`) |

Paths are relative to the project root. Analysis results carry `anchor` (the text of the line) on every source location, and `contentHash` on every file a location points into. See [source-navigation.md](source-navigation.md).

### Operations (consent required)

Operations run project tooling, so they need the user's explicit, single-use consent.

| Id | Platform | Command (no shell) |
| --- | --- | --- |
| `flutter-pub-get` | Flutter | `flutter pub get` |
| `npm-install` | React Native | `npm install` |
| `gradle-assemble-debug` | Android | `./gradlew assembleDebug` (`gradlew.bat` on Windows) |
| `pod-install` | iOS | `pod install` |

1. `GET /v1/projects/:id/operations` lists what is available for the detected platforms.
2. `POST /v1/projects/:id/operations { "operation": "flutter-pub-get" }` never runs anything. It returns `428 confirmation_required` with `details.confirmation = { token, operation, description, command, cwd, expiresAt }` so the UI can show exactly what would run.
3. Only after the user agrees, repeat the request with `"confirmationToken": "<token>"`. The response is `202 { operation }`. The token is single-use, expires after 2 minutes, and is bound to that project and that operation.
4. `GET /v1/operations/:id` returns `{ status: running | succeeded | failed, exitCode, outputTail }`.

### Runtime capture (Phase 3)

See [runtime-capture.md](runtime-capture.md) for requirements and risks.

| Method & path | Body | Response |
| --- | --- | --- |
| `GET /v1/runtime/host` | — | `{ host: { os, iosSupported, androidSdk?, adb?, emulator?, xcrun?, problems[] } }` |
| `GET /v1/runtime/devices` | — | `{ devices: [{ id, name, platform, kind, state: online \| stopped \| booting \| offline \| unauthorized, osVersion?, avd? }] }`. Stopped AVDs have id `avd:<name>` |
| `POST /v1/runtime/devices/:id/boot` | `{ confirmationToken? }` | `428` with the command first, then `202 { device }` |
| `GET /v1/projects/:id/runtime/options` | — | `{ options: { modes, flavors, targets, defaultTarget, sensitiveBuildInputs, notes, flutter: { command, source, version, pinnedVersion, warnings } } }` |
| `POST /v1/projects/:id/runtime/sessions` | `{ deviceId, mode?, flavor?, target?, confirmationToken? }` | `428` with `{ command, cwd, flutter, warnings, sensitiveBuildInputs }`, then `202 { session }`. `409` if a session for the project is active |
| `GET /v1/projects/:id/runtime/sessions` | — | `{ sessions }` |
| `GET /v1/runtime/sessions/:sid` | — | `{ session: { id, status: starting \| building \| installing \| running \| failed \| stopped, phase, error, build, command, vmServiceUri, currentScreen, autoCapture } }` |
| `GET /v1/runtime/sessions/:sid/logs?since=<seq>` | — | `{ lines: [{ seq, at, stream: stdout \| stderr \| event, text }] }` |
| `POST /v1/runtime/sessions/:sid/stop` | — | `202 { session }` |
| `POST /v1/runtime/sessions/:sid/auto-capture` | `{ enabled }` | `{ session }`. Needs a running debug session |
| `GET /v1/runtime/sessions/:sid/detect` | — | `{ detected: { detected: string[], top? } \| null }` |
| `POST /v1/projects/:id/captures` | `{ sessionId? \| deviceId?, screenId? }` | `201 { capture: RuntimeCapture }` |
| `GET /v1/projects/:id/captures` | — | `{ captures: RuntimeCapture[], observations: RuntimeObservation[] }` |
| `POST /v1/projects/:id/captures/:cid/assign` | `{ screenId \| null }` | `{ capture }` |
| `DELETE /v1/projects/:id/captures/:cid` | — | `204` |
| `GET /v1/projects/:id/captures/:cid/image` | — | `{ dataUri }` (PNG) |

## Example session

```bash
TOKEN=…; URL=http://127.0.0.1:4517
curl -s -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
     -d '{"path":"/Users/me/code/shop"}' $URL/v1/projects            # → project.id
curl -s -X POST -H "Authorization: Bearer $TOKEN" $URL/v1/projects/$ID/analyses   # → analysis.id
curl -s -H "Authorization: Bearer $TOKEN" $URL/v1/analyses/$AID      # poll until "succeeded"
curl -s -H "Authorization: Bearer $TOKEN" $URL/v1/analyses/$AID/result
```
