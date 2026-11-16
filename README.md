# vojtah

The source of the start page of [vojtah.cz](https://vojtah.cz): static HTML, one card per public
project, and a small optional sign-in that unlocks further projects for invited people.

| Part | What |
|---|---|
| [`homepage/`](homepage/) | the static page (GitHub Pages) |
| [`tests/`](tests/) | node tests of the page (`node --test tests`) |

The projects are separate repositories:
[InBody Aggregator](https://github.com/vojtechherrmann/inbody-aggregator) (`inbody.vojtah.cz`,
semi-public). Other projects are available on request; the sign-in page only talks to a login API.
