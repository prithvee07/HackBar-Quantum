var ports = new Set(); // Every connected Hackbar panel, so multiple devtools windows all work

function connected(p) {
  ports.add(p);
  p.postMessage({msg: "Connected!"});
  p.onMessage.addListener(function(m) {
    console.log("Background receive:")
    console.log(m.msg);
  });
  p.onDisconnect.addListener(function() {
    ports.delete(p);
  });
}

browser.runtime.onConnect.addListener(connected);


// for (const p of ports) { p.postMessage({msg: "My Msg To Panel"}); }
