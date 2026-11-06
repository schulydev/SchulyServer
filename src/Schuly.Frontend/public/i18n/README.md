# Translations

One JSON file per language, loaded by `@ngx-translate/core` from `/i18n/<lang>.json`. `de.json` is the reference and the fallback: a key missing in another language shows in German. `src/app/core/i18n.spec.ts` fails when a language has keys `de.json` lacks, misses one, or uses other `{{placeholders}}`.

- Keys are namespaced by feature: `overview.attention.title`, `grades.hint.fromZeugnis`. Shared words live under `common.*` and `nav.*`.
- Counts use ICU plurals: `{count, plural, =0 {…} one {# grade} other {# grades}}`. `#` is the number in the language's format. Other values are `{{name}}`.
- Dates, times and numbers are not in these files: they use `Intl` with the language's Swiss locale (`de-CH`, `fr-CH`, `it-CH`, `rm-CH`, `en-CH`).
- Sentence case, "du"-form in German, the same friendly tone as schuly.dev.

## School terms that stay German

These are the words on Swiss school documents and in Schulnetz, so every language keeps them:

- **Zeugnis** (report card), **Promotion** (promotion decision), **Lehrmeister** (apprenticeship trainer).
- The Zeugnis table on the Grades page (Pflichtfächer, Durchschnitt, Negative Notenabweichung, Absenzen unentschuldigt, offen) copies the printed Zeugnis and is not translated at all.
- **Semester** and **Absenz** are kept as the same word where the language has it: *semestre* / *semester*, *absence* / *assenza* / *absenza*.

## Review needed

`rm.json` (Rumantsch Grischun) was written without a native speaker and needs a review before release. `fr.json` and `it.json` are complete but have not been checked by a native speaker either.
