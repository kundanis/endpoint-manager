Endpoint IQ Load Test
=====================

Checks how many endpoints an Endpoint IQ server can handle. The tool pretends to be many Windows
agents (check-ins, policy syncs and reports at the agent's real timings), raises the load in steps,
and writes a report with response times, errors, throughput and - on Endpoint IQ 1.0.36 or later -
the server's CPU, memory and database response.


BEFORE YOU START

1. Run it on a PC other than the server, on the network the endpoints use. The report says if
   that PC was too busy to send the full load (then use a more powerful PC).
2. On a production server, run it during quiet hours.
3. Create an enrollment token (Endpoint Hub -> Enrollment Tokens) with at least as many uses as
   endpoints you will simulate.
4. The licence needs that many free endpoints while the test runs.
5. For more than 20 test endpoints, raise the server's enrollment limit for the test: add
   AGENT_ENROLL_RATE_LIMIT=5000 to the server's .env and restart it (docker compose up -d).
   Remove the line again afterwards. (Endpoint IQ 1.0.36 or later.)


RUN IT

Double-click LoadTest.cmd and answer the questions:
  - server address (the one agents use)
  - enrollment token
  - number of endpoints (for example 2000)
  - whether to raise the load in steps (recommended: 25%, 50%, 75%, 100%)
  - minutes per step (5 is enough; 10 for a final check)

Type START to begin. Ctrl+C stops early; the report is still written.

From a command prompt or script:
  LoadTest.cmd --server https://endpointiq.company.com --token <token> --endpoints 2000 --minutes 5 --yes
  LoadTest.cmd --help        all options

Linux or macOS (Node.js 20 or later):
  node endpoint-iq-load-test.js --server ... --token ... --endpoints 2000


WHAT IT DOES ON THE SERVER

- Adds test endpoints named LOADTEST-0001, LOADTEST-0002... They show in the console during the
  test, and policies assigned to all endpoints apply to them.
- At the end it removes them, with everything they reported, freeing their licences.
- If the tool is closed or the PC restarts mid-test, run it again: it offers to remove the test
  endpoints left behind (they are listed in .load-test-endpoints.json next to the tool, which
  holds their keys - don't share that file).


RESULTS

A folder under "results" for each run:
  report.html    the report (opens by itself): verdict, checks per step, charts, every figure
  results.json   all figures, for comparing runs
  timeline.csv   one row every 10 seconds
  steps.csv      per step and request type

The verdict: Pass = every check passed at the highest load; Warning = near a limit, or failed only
at the highest step; Fail = struggled even at the first step. Checks: response time (95th and
99th percentile), errors and timeouts, whether the server kept up, and on 1.0.36+ the server's
CPU, the app's CPU, the app's responsiveness and the database's response time.
