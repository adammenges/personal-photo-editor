const { invoke } = window.__TAURI__.core;

const appNameInput = document.getElementById("app-name");
const bundleIdInput = document.getElementById("bundle-id");
const statusEl = document.getElementById("status");
const commandDeck = document.getElementById("command-deck");
const shortcutsPanel = document.getElementById("shortcuts-panel");
const btnCheck = document.getElementById("btn-check");
const btnBuild = document.getElementById("btn-build");
const btnReset = document.getElementById("btn-reset");
const bannerEl = document.getElementById("banner");

let showShortcuts = true;

const BANNER_WIDE = [
    "  ____           __",
    " |  _ \\ _   _ ___/ /_",
    " | |_) | | | / __  /",
    " |  _ <| |_| / /_/ /",
    " |_| \\_\\\\__,_\\\\__,_/",
].join("\n");

const BANNER_COMPACT = [
    " __  __  ___",
    "|  \\/  |/ _ \\",
    "| |\\/| | | | |",
    "|  | | |_| |",
    "|_|  |_|\\___/",
].join("\n");

function updateBanner() {
    bannerEl.textContent =
        window.innerWidth < 920 ? BANNER_COMPACT : BANNER_WIDE;
}

function updateCommandDeck() {
    const appName = appNameInput.value.trim();
    const bundleId = bundleIdInput.value.trim();
    commandDeck.textContent =
        `$ ./scripts/dev.sh\n$ ./scripts/check.sh\n$ APP_NAME="${appName}" APP_BUNDLE_ID="${bundleId}" ./scripts/build_macos_app.sh`;
}

function setStatus(msg) {
    statusEl.textContent = msg;
}

async function runChecks() {
    const result = await invoke("get_check_command");
    setStatus(result);
}

async function buildApp() {
    const result = await invoke("get_build_command", {
        appName: appNameInput.value,
        bundleId: bundleIdInput.value,
    });
    setStatus(result);
}

function resetAll() {
    appNameInput.value = "MyMacApp";
    bundleIdInput.value = "com.example.mymacapp";
    setStatus("Ready. Cmd+R runs checks, Cmd+B prints the build command.");
    updateCommandDeck();
    appNameInput.focus();
    appNameInput.select();
}

function toggleShortcuts() {
    showShortcuts = !showShortcuts;
    shortcutsPanel.style.display = showShortcuts ? "flex" : "none";
    setStatus(
        showShortcuts
            ? "Shortcut overlay enabled. Cmd+/ hides it."
            : "Shortcut overlay hidden. Cmd+/ shows it.",
    );
}

btnCheck.addEventListener("click", runChecks);
btnBuild.addEventListener("click", buildApp);
btnReset.addEventListener("click", resetAll);

appNameInput.addEventListener("input", () => {
    setStatus(`APP_NAME set to "${appNameInput.value}".`);
    updateCommandDeck();
});

bundleIdInput.addEventListener("input", () => {
    setStatus(`APP_BUNDLE_ID set to "${bundleIdInput.value}".`);
    updateCommandDeck();
});

document.addEventListener("keydown", (e) => {
    const isMeta = e.metaKey;

    if (!isMeta) return;

    switch (e.key) {
        case "1":
            e.preventDefault();
            appNameInput.focus();
            appNameInput.select();
            setStatus("Focus: APP_NAME field.");
            break;
        case "2":
            e.preventDefault();
            bundleIdInput.focus();
            bundleIdInput.select();
            setStatus("Focus: APP_BUNDLE_ID field.");
            break;
        case "/":
            e.preventDefault();
            toggleShortcuts();
            break;
        case "r":
        case "R":
            e.preventDefault();
            runChecks();
            break;
        case "b":
        case "B":
            e.preventDefault();
            buildApp();
            break;
        case "k":
        case "K":
            e.preventDefault();
            resetAll();
            break;
    }
});

window.addEventListener("resize", updateBanner);
updateBanner();
updateCommandDeck();
