# Evidence

`temporal-web-ui.png` shows one representative opening Workflow (`opening-2026-10-05-2130-maya-5679`) in the Temporal Web UI, with status **Completed** and its event history. All names and numbers are fictional sample data.

What the history shows:

- **Ana Ruiz** was offered first. Her hold **timer** ran out, so the Workflow moved on by itself.
- **Chloe Park**'s `sendText` Activity failed on every retry, so she was marked failed.
- **Ben Ortiz** was offered next.
- Ana replied "yes" after her hold ended. The `respondToOffer` **Update** returned `{"result":"expired"}`.
- Ben accepted. A second `respondToOffer` Update cancelled his **Timer**, `bookClient` removed him from the waitlist, and `sendText` sent his confirmation. The Update returned `{"result":"accepted"}`.
- The Workflow completed with status `filled`.
