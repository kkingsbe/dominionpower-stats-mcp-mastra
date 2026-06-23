# AGENTS.md

## CRITICAL: Load `mastra` skill first

Load the `mastra` skill BEFORE any Mastra work. Never rely on cached knowledge — APIs change between versions.

## Dominion Energy MCP Server

This project implements a Mastra MCP server that exposes Dominion Energy data (usage, billing, solar, weather, meter info) as MCP tools. Authentication uses Playwright-based browser automation for TFA support.

## Architecture

- `src/mastra/index.ts` — Mastra config: registers MCPServer with DominionService
- `src/mastra/lib/dominion-service.ts` — Service container: auth init, API client, background poller, tool creation
- `src/dominion/` — Pure API client library (copied from root project)
- `src/server/` — Cache, poller, reauth handler (copied from root project)
- `src/auth-browser/` — Playwright-based login + TFA flow (copied from root project)
- `src/config.ts` — Env var parsing via Zod (copied from root project)

## Rules

- Register all agents, tools, workflows, and scorers in `src/mastra/index.ts`
- Use the `dev` and `build` scripts from `package.json` instead of running `mastra dev` / `mastra build` directly

## Resources

- [Mastra Documentation](https://mastra.ai/llms.txt)
- [Skills Discovery](https://mastra.ai/.well-known/skills/index.json)
