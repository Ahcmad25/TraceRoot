# Reproducibility validation

These checks require no provider credentials and make no API calls.

## Fresh clone

```sh
git clone https://github.com/Ahcmad25/TraceRoot.git
cd TraceRoot
npm ci
npm run typecheck
npm test
npm run build
npm test -- tests/agentic/runner.test.ts
npm run evaluate:all -- --repetitions 3
```

The targeted runner test executes an end-to-end investigation with the fake provider and controlled local target. The evaluation command is a planning dry run unless `--execute` is explicitly supplied; its output should enumerate 48 pending slots and state that no provider calls were made.

Do not add `--execute` during clean-room validation. It makes real OpenAI API calls and incurs cost.

## Windows PowerShell

The commands are identical in PowerShell:

```powershell
git clone https://github.com/Ahcmad25/TraceRoot.git
Set-Location TraceRoot
npm ci
npm run typecheck
npm test
npm run build
npm test -- tests/agentic/runner.test.ts
npm run evaluate:all -- --repetitions 3
```

## Docker alternative

```sh
docker build -t traceroot .
docker run --rm traceroot
docker run --rm traceroot npm test -- tests/agentic/runner.test.ts
docker run --rm traceroot npm run evaluate:all -- --repetitions 3
```

The image contains no credentials. Docker Desktop was unavailable on the packaging machine, so the Docker procedure is documented but not locally verified; the native clean-install-equivalent checks are the validated path.

## Expected safety properties

- `.env` is ignored and `.env.example` contains names/placeholders only.
- `results/`, `dist/`, `coverage/`, `node_modules/`, and `*.log` are ignored, except public benchmark logs explicitly allowlisted by `.gitignore`.
- Fake-provider and dry-run commands need no `OPENAI_API_KEY`.
- Real investigation commands fail closed without explicit model and credential environment variables.
