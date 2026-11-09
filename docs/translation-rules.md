# Translation rules

These rules are the contract for every reviewed translation: contributors, maintainers and
the automated first pass all apply the same checklist. `InterfaceDictionaryTest` enforces the
mechanical parts (tags, numbers, placeholders, duplicates).

They are language neutral: every text that is not a proper noun is translated **into the
target language**, and the examples below are only about what is translated, not about the
language of the output.

## Words that stay in English

| Category | Examples |
| --- | --- |
| NPCs and bosses | `Duke Horacio`, `Redbeard Frank`, `Zulrah`, `Araxxor`, `Vorkath` |
| Items | `Mackerel`, `Flax`, `Jute seeds`, `Rune Hasta`, `Abyssal whip` |
| Places | `East Ardougne`, `Port Sarim`, `Catherby`, `Varrock Museum`, `Gu'Tanoth` |
| Quest names | `Biohazard`, `Plague City`, `Cook's Assistant`, `Bone Voyage` |
| Storylines | `Elf #2`, `Pirate #2`, `Order of Wizards #1` |
| Skills | `Ranged`, `Cooking`, `Hunter`, `Agility`, `Farming`, `Herblore` |

Rule of thumb: if the word is a proper name in game (capitalised and referring to a unique
entity), it is not translated.

**Item names stay in English even inside a sentence.** `Buy a candle from the Chandler` keeps
`candle`; only the surrounding words are translated. The same applies to `flax`, `coal`, `egg`,
`flour`, `milk`, `cake`, `tea`, `stew`, `bass`, `mackerel`, `shark`, `Jute seeds`,
`Limpwurt root`, `Maple logs`, `Stamina Mix`...

## Words that are translated

* descriptive sentences (`I can start this quest by talking to ...` keeps the structure, with
  the translated verbs);
* interface labels: `Difficulty:`, `Length:`, `Storyline:`, `Release Year:`, `Requirements:`,
  `Recommendations:`, `Show on Map`;
* tiers: `Easy/Medium/Hard/Elite`, `Novice/Intermediate/Experienced/Master/Grandmaster`,
  `Short/Long/Very Short/Very Long`;
* generic words in headings: `Tasks`, `Description`, `Type`;
* generic nouns: `quest`, `miniquest`, `task`. The **name** of a quest or miniquest stays in
  English (`Bone Voyage`), the generic word does not.

## Structure (enforced by tests)

1. Every `<col=...>`, `</col>`, `<br>`, `<str>` tag appears **exactly the same, in the same
   order**. A wrong tag breaks the colours on screen.
2. Keep every number that appears in the original.
3. `re:` entries keep their `$1`, `$2` placeholders and must not add new groups.
4. A paragraph split across several widgets is translated **line by line**, without adding or
   removing line breaks.
5. Keys are exact: leading/trailing spaces, punctuation and capitalisation included.

## Style

* Neutral, natural language for the target locale; avoid regionalisms.
* Diary tasks use the imperative form of the target language.
* Keep sentences short: the interface wraps at a fixed width.
* Do not add information that is not in the original.
* The output is written **only in the target language**. English is kept for the proper nouns
  above, and nothing else.

## Automated first pass (prompt template)

```
You translate Old School RuneScape interface texts from English to <language>.

Rules:
- Keep NPCs, bosses, items, places, quest names, storylines and skill names in English.
- Translate only the descriptive text and interface labels.
- Copy every <col=...>, </col>, <br> and <str> tag exactly, in the same order.
- Keep all numbers.
- Do not add or remove line breaks.
- Neutral, short, imperative for tasks.

Reply with one line per input, in the same order, as: <translation>
Do not include the original text, numbering or explanations.

Input:
<one english text per line>
```

The output is reviewed before merging; it is never committed automatically.

## Review checklist

- [ ] names and skills untouched
- [ ] tags identical
- [ ] numbers identical
- [ ] no new/removed line breaks
- [ ] written entirely in the target language
- [ ] reads naturally
- [ ] `./gradlew build` passes
