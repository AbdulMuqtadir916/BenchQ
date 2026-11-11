# The autofill engine

One unit built from two open-source projects, used by the side panel to work out what a form field asks for and which
answer fits it. `src/autofill/` remains the product code: never-fill rules, strict matching, the review list and the
fill loop. This folder only adds recognition, behind those rules.

| Folder | From | Licence |
|---|---|---|
| `ats-autofill-engine/` | [ats-autofill-engine](https://github.com/ebenezer-isaac/ats-autofill-engine) `f5a3ed9`: per-site field rules, the field taxonomy | MIT |
| `ats-autofill-engine/core/heuristics/mozilla/` | The same repo, ported from Mozilla's form autofill heuristics | **MPL-2.0** |
| `universal-ai-autofill/` | [universal-ai-autofill](https://github.com/Vikhyat24/universal-ai-autofill) `e7f3d50`: weighted fuzzy field matching | MIT, declared in its `package.json` |
| `*.ts` here | BenchQ: the merged taxonomy, the classifier that joins them, QA bank lookups | |

Licence texts ship with the extension in `public/licenses/`.

## Rules for this folder

- **Don't edit the MPL folder** unless you're ready to keep the change under MPL-2.0 and publish that file's source.
- `ats-autofill-engine/` and `universal-ai-autofill/` are trimmed copies: what the extension never used is gone (fill
  planning, adapters, the profile editor, learned mappings). Put BenchQ changes in the files beside them.
- Nothing here touches the page or the network. The extension never calls an LLM: despite its name,
  universal-ai-autofill makes no AI calls.

## How a field is resolved

`src/autofill/review.ts`, in this order, stopping at the first that answers:

1. **Never fill:** `never-fill.ts`, then the engine's `manualOnlyReason`.
2. **What it asks for:** the strict `fieldTypeFor`, then `classifyField`: site rules, Mozilla, fuzzy matcher.
3. **QA bank:** strict `matchBank`, then entries of the same type.
4. **Inside another answer:** `derive.ts`, like the city in "Dallas, TX" or the first name in a full name.
5. **A close wording:** `closestBankEntry`.
6. **The BDE:** anything else stays unticked in the list, with the reason, for the BDE to fill.
