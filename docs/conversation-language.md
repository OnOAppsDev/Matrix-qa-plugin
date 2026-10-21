# Conversation language

Every `/qa-*` command talks to the QA engineer in the **project language** (`language` in `matrix-qa.config.json`): `he` → Hebrew, `en` → English.

## What is translated

- Every `AskUserQuestion`: the question, the header, each option label and description.
- Proposals, summaries, reports, explanations, warnings and next steps.
- Agent output shown to the QA engineer (agents already return it in the project language).

## What stays in English

Technical identifiers, also inside Hebrew text: command names (`/qa-plan`), IDs (`LOGIN-TC-001`), statuses (`DRAFT`, `REVIEWED`, `APPROVED`, `CHANGES_REQUIRED`), severities, file paths, environment and project names, environment variable names, code, and script output. In Hebrew text, write them as inline code so they stay readable in right-to-left text.

## Before a config exists

`/qa-init` asks the language first, as its own question in both languages ("באיזו שפה לעבוד? / Which language should we work in?", options "עברית (Hebrew)" / "English"), and continues in the chosen language.

## Switching

If the QA engineer explicitly asks for the other language, use it for the rest of the session. The plans keep the project language; changing that is a `language` change in the config.

## Fixed options

Use these wordings so the approval choices are always unambiguous:

| Command | English | Hebrew |
|---|---|---|
| `/qa-init` | Apply this initialisation · Change settings · Cancel | החלת ההגדרה · שינוי הגדרות · ביטול |
| `/qa-plan` (design) | Is there a Figma design for this feature? — Paste Figma links · No design for this feature | האם יש עיצוב Figma לפיצ'ר? — הדבקת קישורי Figma · אין עיצוב לפיצ'ר הזה |
| `/qa-plan` | Approve the test plan · Request changes · Not now | אישור תוכנית הבדיקות · בקשת שינויים · לא עכשיו |
| `/qa-review` | Review read-only · Review and record findings | סקירה ללא שינוי · סקירה ותיעוד ממצאים |
| `/qa-approve` | Approve · Do not approve | אישור · לא לאשר |
| `/qa-sync` | Apply all proposed changes · Apply a subset · Editorial only — keep the approval, no test changes · Cancel | החלת כל השינויים המוצעים · החלת חלק מהשינויים · עריכה בלבד — האישור נשמר, ללא שינוי בבדיקות · ביטול |
| `/qa-run` (protected environment) | Run on `<environment>` · Cancel | הרצה על `<environment>` · ביטול |
| `/qa-run` (end) | Open the report · Not now | פתיחת הדוח · לא עכשיו |

The guard's confirmation prompts (approval, `--keep-approval`, `init apply`, edits to approved plans and existing automation) also follow the project language. Its refusals stay in English; explain them to the QA engineer in the project language.
