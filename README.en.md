# cold-dialer (English summary)

An open source B2B cold calling workstation that each team configures for its own niche: call queue, script, one-key call outcomes,
callbacks and meetings; upstream, the list of companies to call and an opening line taken from their website; downstream, the call
debrief and market feedback. Next.js 15 and Supabase, can be hosted in the European Union (you choose the Supabase and Vercel
regions), MIT licence. The interface and docs are in French. *Screenshots to come.*

## Getting started

1. **Copy the template** to your GitHub account as a private repository: "Use this template" on
   https://github.com/Aupsyy/cold-dialer, or `gh repo create <name> --private --template Aupsyy/cold-dialer --clone`.
2. **Install**: with Claude Code, the `installer` skill (in `skills/`) asks the questions and runs the commands; by hand, follow
   `docs/installation.md` (Supabase, Vercel, telephony, calendar, team).
3. **Configure your niche** in `config/niche.json`, starting from `config/niche.exemple.json`: `npm test` tells you what is missing
   and refuses any promise of results.

Questions: [discussions](https://github.com/Aupsyy/cold-dialer/discussions). Bugs and ideas: an
[issue](https://github.com/Aupsyy/cold-dialer/issues/new/choose). Security: `SECURITY.md`, never a public issue.

## What it is, and for whom
- A workstation for teams that call COMPANIES to book a meeting: agencies, freelancers, sales teams working in French.
- One instance per team, installed on your own GitHub, Supabase and Vercel accounts. The whole business logic lives in
  `config/niche.json` (a full fictional example: `config/niche.exemple.json`), validated at build time.

## What it is not
- **No guaranteed meetings or figures**: the tool organises the work; results depend on the offer and on the caller. The config
  rejects any result promise in what is said to prospects.
- Nothing is ever sent to a prospect automatically (no call, text or e-mail). Not for calling consumers; no LinkedIn scraping.

## The four blocks
Call workstation (`docs/telephonie.md`, `docs/agenda.md`), lead sourcing from the French SIRENE register (`docs/sourcing.md`),
opening lines from company websites with an anti-invention check (`docs/accroches.md`), call debrief and market feedback
(`docs/debrief.md`). Calendars: Calendly, iClosed, Google Calendar or internal, plus an ICS feed per person. A Settings screen holds
the team, invitation links shown once, the attempts cap and daily goal, call recording with its legal framework, and the GDPR purge.

## Architecture
Next.js 15 on Vercel (functions in Paris, `cdg1`); Supabase (Paris region in the install guide) with row level security on every
table and one team per instance; all business settings in `config/niche.json`. No AI key in the app: Claude Code skills extract.

## Installation
Guided by the Claude Code skill `installer` (`skills/README.md` explains how to link the five skills), or by hand with
`docs/installation.md`. You need Node.js 22.18+, git, and GitHub, Supabase and Vercel accounts.

## Telephony and calendars
Onoff (Chrome extension), Aircall (embedded phone), Ringover (embedded phone, **experimental, never tested on a real account**), any
softphone (`tel:`, `callto:`, `sip:` links) or your own phone. Calendly webhooks need a paid plan and a signing key of 32+ characters;
Google OAuth apps left in "Testing" lose their refresh token after 7 days; a Google event that matches no lead is not kept.

## Legal, hosting, limits, contributing
Public sources only, B2B legitimate interest, an opposition list, recording only after an announcement for that call: `docs/legal.md`
(not legal advice). Vercel Hobby is non-commercial (agencies need Pro); free Supabase projects pause after 7 idle days. Known limits:
French `README.md`. Contributing: `CONTRIBUTING.md`; licence: MIT (`LICENSE`); security: private reporting via GitHub (`SECURITY.md`).
