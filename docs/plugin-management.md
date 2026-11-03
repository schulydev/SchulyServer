# Plugin management

Plugins connect Schuly to school systems. Your server downloads them from a registry, so you don't
copy any files by hand.

## Add or remove a plugin

Edit `config/plugins.yml` and restart the backend:

```yaml
plugins:
  - name: Schuly.Plugin.Schulware
    version: latest
  - name: Schuly.Plugin.Microsoft
    version: latest
  - name: Schuly.Plugin.OdaOrg
    version: latest
```

On startup, the server downloads what's listed and removes what isn't. A plugin's school system
then appears in the app automatically. There is no admin API for plugins.

### Run without Microsoft 365

1. Remove `Schuly.Plugin.Microsoft` from `plugins.yml`.
2. In `compose.staging.yml`, remove the `schulymicrosoft` service and the matching entry in the
   backend's `depends_on`.

## Configure a plugin

Each plugin reads `config/plugins-config/<AssemblyName>.yml`. The defaults work for most servers.

- **Absence reasons:** set `AbsenceReasons` in `Schuly.Plugin.Schulware.yml`, keyed by the host of
  the school's Schulnetz URL.
- **Microsoft service:** the Microsoft plugin needs `MicrosoftApi.BaseUrl` in
  `Schuly.Plugin.Microsoft.yml` and doesn't start without it.

## Change when a task runs

Plugins run recurring tasks, such as syncing a timetable. To override a task's schedule, add it to
the plugin's config file:

```yaml
Schedules:
  schulware.sync-timetable:
    Cron: "0 6 * * *"
    Retries: 3
    RunOnStartup: false
```

If the schedule can't be parsed, the plugin's default applies. The same keys work as
`SCHULY_PLUGIN_<NAME>_` environment variables.

Schuly keeps each task's schedule and run history in the `PluginTasks` table. A run that was due
during downtime runs once after the next start. A task never overlaps with itself.

## Settings

| Key | Default | Purpose |
|---|---|---|
| `Plugins:Registry` | SchulyPlugins `repo` branch | Registry base URL |

When the registry index lists a SHA-256 hash for a download (`sha256`, `depsSha256`), the server checks
it and keeps the installed version on a mismatch. The index lists hashes for the latest build only, so
a pinned older version installs unchecked. The hashes come from the same branch as the files, so they
catch a damaged or swapped download, not a compromised registry.
| `Plugins:File` | `<app>/plugins.yml` | The list of plugins |
| `Plugins:Directory` | `<app>/plugins` | Where plugin DLLs are stored |
| `Plugins:ConfigDirectory` | `<app>/plugins-config` | Where plugin config files are stored |

## How it works

Each plugin runs in its own collectible `AssemblyLoadContext` with its own service container. The
host wires in its controllers, endpoints, and background tasks when it loads the plugin, and removes
them when it unloads it. Shared dependency DLLs are reference-counted, so removing one plugin never
deletes a DLL that another plugin uses.
