# WitsPath-Web

Accessible route planning for Wits University West Campus.

## Map provider

The campus map is currently drawn locally as an inline SVG, so the interface
does not depend on a third-party map service while the team evaluates providers.
The `map` property in `window.appState` is reserved for the eventual
provider map object. Replace the SVG map surface and connect the chosen SDK
there when a provider is selected.

Run the project from a local web server so the browser can fetch
`data/wits-west-map.json`.

Dark mode is available from the header toggle or Preferences and is saved
between visits. Step-by-step directions are revealed only after starting
navigation.
