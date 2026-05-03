# Kaizen: A GitHub Copilot Hook Plugin

This repository hosts a plugin that implements **Kaizen**, a continuous-improvement hook that captures tool-usage observations in SQLite and surfaces structured insights at the start of each new session.
The goal of the plugin is to structure the auto-learning process for LLM agents, enabling them to reflect on past interactions and improve over time.

## Behavioral guidelines


If applicable, use RGR to complete the task.

RED: write one test
GREEN: write the implementation to pass that test
REPEAT until done
REFACTOR the code

<verified_claims>

### 1. No Unverified Technical Claims

- Never explain how a technology, SDK, or tool works unless you have read the actual source, official documentation, or verified output that proves it.
- If you cannot cite the exact file, URL, or command output that supports your claim, say "I don't know" instead.
- Speculation presented as fact is a critical failure.
- If you need to make an assumption to proceed, state it explicitly and label it as an assumption.
</verified_claims>
<clear_assumptions>

### 2. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.
</clear_assumptions>

<simplicity_first>

### 3. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.
</simplicity_first>
<surgical_changes>

### 4. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.
</surgical_changes>
<goal_driven_execution>

### 5. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```text
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
</goal_driven_execution>

<testing>

### 6. Testing Discipline

**Il codice è indipendente dai test. Mai il contrario.**

- Mai inserire branch condizionali per i test nel codice di produzione (`if (!__TEST_MODE)`, `if (process.env.TEST)`, ecc.). Se lo fai, il codice è scritto male.
- Mai creare file, export, o parametri che esistono solo per rendere il codice testabile. Se non riesci a testarlo, l'architettura è sbagliata.
- Mai adattare il codice ai test. I test si adattano al codice.
- Se il codice non è testabile, o il codice è scritto male o il test è inutile. Riscrivi il codice, non aggiungere hack.
- I test esercitano le funzioni di `lib/` direttamente con DB temporanei isolati. Non importano mai il layer di wiring SDK (`extension.mjs`).
</testing>

<no_wrappers>

### 7. Non Reinventare Quello Che Esiste

**Se il SDK lo fornisce, usalo. Non wrapparlo.**

- Non creare librerie custom per funzionalità che il framework/SDK già offre (es: `session.log()` esiste → non creare `lib/log.mjs`).
- Non creare file separati "per separazione dei concern" quando un singolo file è più chiaro (es: non splittare `extension.mjs` in `extension.mjs` + `entrypoint.mjs`).
- Non aggiungere env var o astrazioni solo per facilitare i test.
- Un file singolo è meglio di due file se il secondo esiste solo per testabilità o "pulizia architettturale" che nessuno ha chiesto.
- Riferimento architetturale: `copilot-ledger` — un solo `extension.mjs` con `joinSession()` a module-level, handler privati (nessun export), `session.log()` per osservabilità.
</no_wrappers>
