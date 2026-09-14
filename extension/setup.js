const command = "gh auth token --hostname github.com | sed 's/^/Authorization: Bearer /' | curl -fsSL -H @- -H 'Accept: application/vnd.github.raw+json' https://api.github.com/repos/ankitiscracked/sublists/contents/install.sh | bash";
document.querySelector("#command").textContent = command;
document.querySelector("#copy").onclick = async () => {
  try { await navigator.clipboard.writeText(command); document.querySelector("#status").textContent = "Command copied."; }
  catch { document.querySelector("#status").textContent = "Select and copy the command above."; }
};
document.querySelector("#check").onclick = async () => {
  const status = document.querySelector("#status"); status.textContent = "Checking companion…";
  try {
    const r = await chrome.runtime.sendMessage({action: "ping"});
    status.textContent = r?.ok ? "Companion connected. Use Save on Substack to choose an Apple Notes folder." : r?.error || "Companion unavailable.";
  } catch { status.textContent = "Companion unavailable. Run the install command and retry."; }
};
