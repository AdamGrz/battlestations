# Battle Stations! online
1. Install Node 18+ on your host. 2. `node server.js` (set PORT if needed). 3. Open http://your-host:3000
Enter your name and press Create game. It appears in the lobby list for other players, who press Join (or send them the page link, which ends in #CODE; tick Private to hide the game from the list).
Both players arrange their fleet and press Ready, then lock in orders each turn. The server is the referee: it never sends a player the other fleet, so nobody can peek.
No npm packages needed. Games live in server memory (restarting the server ends them) and expire after 6 idle hours.
Reconnect: refresh or reopen the same link on the same browser. Rules PDF: public/rules/BATTLE_STATIONS.pdf
"# battlestations" 
