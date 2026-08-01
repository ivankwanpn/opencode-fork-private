import path from "path"
import os from "os"

const testRoot = path.join(os.tmpdir(), "opencode-core-test-data-" + process.pid)
process.env.XDG_DATA_HOME = path.join(testRoot, "share")
process.env.XDG_CACHE_HOME = path.join(testRoot, "cache")
process.env.XDG_CONFIG_HOME = path.join(testRoot, "config")
process.env.XDG_STATE_HOME = path.join(testRoot, "state")
process.env.OPENCODE_TEST_HOME = path.join(testRoot, "home")
process.env.OPENCODE_DB = ":memory:"
process.env.OPENCODE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.OPENCODE_DISABLE_MODELS_FETCH = "true"
// Pin the client identity so module-level User-Agent constants (e.g. models-dev)
// are deterministic regardless of the ambient OPENCODE_CLIENT inherited from the
// launcher process.
process.env.OPENCODE_CLIENT = "cli"
