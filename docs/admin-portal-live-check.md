# Admin Portal live check

## Local verification

Verified on November 18, 2026 against the Docker Supabase stack. On macOS, setup initially hit a BSD `sed` illegal-byte-sequence error. After the script set `LC_ALL=C` for the affected commands, `SKIP_MAPS=1 scripts/dev-setup.sh` completed under the default locale. A local Ulap PMTiles file was uploaded through the Portal to a disposable Destination.

- The seeded team account signed in. A separate signed-in account saw “Not a team account.” An insert sent directly to the local Supabase REST API with that account’s token returned HTTP 403 and SQLSTATE `42501`.
- Uploading `apps/admin/test/fixtures/test-trail.gpx` displayed six points and 1.44 km. Before the fix, the map displayed no preview line and the console reported that the MapLibre worker failed to load. After the fix, MapLibre returned rendered LineString features from the dashed `trail-preview` layer before saving. This passed in both `npm run dev` and the production build served by `npm run preview`.
- The disposable Destination started at version 1 with zero Trails. Saving added **Test Trail & Ridge**. Publishing incremented the Destination Pack to version 2 and recorded the publish in the Portal.
- The mobile app’s anonymous `createCatalog` returned version 2 from both `listDestinations` and `fetchContent`. The returned Trail had six positions and a distance of 1,436 m. The map URL returned HTTP 200 and 1,788,256 bytes. The phone download remains part of the hosted check.
- The tested screens use the terms in `CONTEXT.md`, including Admin Portal, Destination, Trail, Waypoint and Destination Pack.

Admin checks passed with 34 tests, typecheck and build.

## Hosted checklist

Use a disposable Test Destination and follow the test and cleanup procedures in the [Wave 4 report](waves/wave-4-report.md#1-admin-portal-author-publish-re-download-clean-up).

- [ ] Create the three team accounts in hosted Supabase Auth with the emails already on the team allowlist. Confirm each email and have each person sign in to the Admin Portal.
- [ ] Create the Test Destination and upload a GPX file. Verify the dashed Trail appears before **Save Trail**, then save the Trail.
- [ ] Publish and confirm the Destination Pack version increments.
- [ ] Download the pack or update on a phone. Open it in airplane mode and verify the published Trail and map.
- [ ] Remove the Test Destination and its map from the hosted project, and remove the test pack from the phone.
