# OBS Pet Agents Working Notes

## Build And Deploy

- After any code change, run `npm run build` from `D:\VS_project\OBS_PetAgents`.
- Deploy the latest build artifacts to `D:\ObsidianData\Note\.obsidian\plugins\obs-pet-agents`.
- Always overwrite these files:
  - `manifest.json`
  - `main.js`
  - `styles.css`
  - `versions.json`

## Obsidian CLI Refresh

- Target vault name is `Note`.
- After copying files, refresh Obsidian with this sequence:
  - `obsidian reload vault=Note`
  - wait a few seconds for the CLI command set to come back
  - `obsidian plugin:enable id=obs-pet-agents filter=community vault=Note` if the plugin is not enabled yet
  - `obsidian plugin:reload id=obs-pet-agents vault=Note`
- Verify the final state with:
  - `obsidian plugin id=obs-pet-agents vault=Note`
  - `obsidian plugins:enabled filter=community format=json vault=Note`

## Paths And IDs

- Project root: `D:\VS_project\OBS_PetAgents`
- Vault plugin dir: `D:\ObsidianData\Note\.obsidian\plugins\obs-pet-agents`
- Plugin id: `obs-pet-agents`

## Notes

- If `plugin:enable` says success but `plugin id=obs-pet-agents vault=Note` still shows `enabled=false`, wait a couple seconds and check again.
- If Obsidian CLI temporarily reports missing commands right after `obsidian reload vault=Note`, wait for the app to finish reloading before retrying plugin commands.
