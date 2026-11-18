# Admin Portal live check

## Local findings

On the latest origin/main, `scripts/dev-setup.sh` could not start the local stack because Docker was not running. Docker Desktop was requested to start; the live checks below remain unverified. The Admin Vite server started on localhost:5174, but without a local backend this does not establish authentication or publishing behavior. No hosted accounts were accessed.

- Pending: sign in with a non-team identity and observe “Not a team account”; independently verify database writes are denied for that identity.
- Pending: upload GPX and confirm its Trail is mapped before Save Trail.
- Pending: publish a Destination Pack, confirm the version increases, and query the published version and contents using the same public query as mobile.
- Pending: inspect live terminology against CONTEXT.md. Existing Admin strings are inline English; the module strings.ts English/Filipino convention is not established here.
- Physical phone testing was reserved for issue #62 and was not performed. A public query cannot prove a phone downloads or stores a pack.

Recovery: start Docker Desktop, rerun `scripts/dev-setup.sh`, start the Admin server on port 5174, and repeat the checks above against the local stack. Do not record credentials in this document.

## Hosted checklist for a human

- [ ] Create three team accounts in Supabase Auth and grant the intended team membership.
- [ ] Confirm each account can complete its first login.
- [ ] Upload a GPX and confirm the Trail appears on the map before saving.
- [ ] Publish a Destination Pack and confirm its version increases.
- [ ] Download the published Destination Pack on a phone and verify its contents.
