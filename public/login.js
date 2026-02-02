function setCurrentIp(ip) {
    localStorage.setItem("switchIp", ip);
  }
  
  async function pingSwitchDb(ip) {
    const url = new URL("/api/ports", window.location.origin);
    url.searchParams.set("ip", ip);
    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || `${res.status} ${res.statusText}`);
    }
    return res.json();
  }
  
  const form = document.getElementById("loginForm");
  const ipInput = document.getElementById("ipInput");
  const errBox = document.getElementById("loginError");
  
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errBox.textContent = "";
  
    const ip = ipInput.value.trim();
    if (!ip) return;
  
    try {
      // Optional but recommended: verify the file exists by calling the API once
      await pingSwitchDb(ip);
  
      setCurrentIp(ip);
      window.location.href = "/"; // go to editor
    } catch (err) {
      errBox.textContent =
        `Could not load DB for ${ip}. Make sure this file exists:\n` +
        `data/switches/${ip}.json\n\n` +
        `Error: ${err.message}`;
    }
  });
  