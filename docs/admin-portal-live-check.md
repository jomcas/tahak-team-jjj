# Admin Portal live check

## Local findings

On 18 November 2026, the local Supabase stack and Admin Vite server on port 5174 were used. Docker initially was stopped; after starting Docker Desktop, setup succeeded with `LC_ALL=en_US.UTF-8 SKIP_MAPS=1`. The initial setup under this machine's invalid `C.UTF-8` locale hit an unbound variable at the map-cut message; bracing the variable fixes that expansion. A subsequent setup with `LC_ALL=C.UTF-8 SKIP_MAPS=1` succeeded. Map upload and phone map download were not verified.

- A locally created authenticated non-team user saw “Not a team account”. A separate authenticated REST update of Batulao returned zero rows, confirming that particular write was denied by row security.
- A team user uploaded `apps/admin/test/fixtures/test-trail.gpx` in New Trail. The form reported a six-point, 1.44 km preview and that the dashed line was unsaved until Save Trail. Map tiles appeared, but the browser logged MapLibre worker failures and the dashed line was not visually confirmed. No Trail was saved; the mapped line needs another check in a working browser.
- A direct authenticated database update first changed local Batulao version 2 to 3. The Admin Portal then published version 3 to 4 and recorded the publish. No content edit was made as part of that publish.
- After publishing, anonymous queries matching mobile's `destination-pack/catalog.ts` returned Batulao version 4, two Trails (New Trail and Old Trail), eight Waypoints and 28 reference passages. This verifies public content visibility, not a phone download or the effect of a content edit.
- The observed interface uses Destination, Trail, Waypoint and Destination Pack. This was not an exhaustive terminology audit. Existing Admin strings are inline English; the module `strings.ts` English/Filipino convention is not established here.
- The physical phone was reserved for issue #62. A public query cannot prove a phone downloads or stores a pack.

## Hosted checklist for a human

- [ ] Create three team accounts in Supabase Auth and grant the intended team membership.
- [ ] Confirm each account can complete its first login.
- [ ] Upload a GPX and confirm the Trail appears on the map before saving.
- [ ] Edit content, publish a Destination Pack and confirm its version increases.
- [ ] Download the published Destination Pack on a phone and verify its contents.
