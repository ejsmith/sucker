# Authoritative Sucker Punch chance

The local browser regression forces the client's display random source to produce a one while the isolated server fixture generates a six. Before the fix, the dialog shows 1 / 10% (`before.png`), but the successful throw response reports chanceDie 6. The assertion fails with expected 1, received 6.

After the fix, the Roll action asks the server to prepare a chance. The dialog shows the stored six / 75% (`after.png`), and the throw response and persisted action history match. A unique game/player/target-turn row retains the same chance across reopen, concurrent preparation, and request retries. Preparation costs no tokens; throwing retains the existing three-token cost. Authenticated clients cannot access the attempt table directly, and client-supplied chance values are ignored.

The integration regression covers unauthorized preparation, repeated and concurrent preparation, request replay, token balances, spoofed client chance, and rejection after the response window ends. Existing direct-throw clients remain supported. Deploy the migration and updated Edge Function before distributing the new client; no hosted deployment was performed in this review.

This change preserves the current set of punchable turns. The broader rule/spec discrepancy is tracked separately.

Review follow-up: the schema's later bulk authenticated-table grant overrode the early attempt-table revoke. A local probe applied the exact schema grant statements in a rolled-back transaction and confirmed SELECT privilege was restored. Moving the revoke after the bulk grant makes that same probe pass. The migration already had the correct final privileges. Permission-probe screenshots document both results.
