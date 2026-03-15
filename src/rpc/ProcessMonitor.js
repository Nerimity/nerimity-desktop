import { readdir, readFile } from "fs/promises";
import { EventEmitter } from "events";

// Configuration
const GITHUB_ASSETS_URL = "https://raw.githubusercontent.com/XansiVA/nerimity-rpc-assets/main/assets";
const POLL_INTERVAL = 5000; // Check every 5 seconds

// Game database - add more games here!
const GAME_DATABASE = {
  "hollowknight": {
    name: "Hollow Knight",
    action: "Playing",
    image: "hollowknight.png",
    patterns: ["hollowknight", "hollow knight", "hollow_knight"]
  },
  "celeste": {
    name: "Celeste",
    action: "Playing",
    image: "celeste.png",
    patterns: ["celeste"]
  },
  "minecraft": {
    name: "Minecraft",
    action: "Playing",
    image: "minecraft.png",
    patterns: ["minecraft", "java"]
  },
  "terraria": {
    name: "Terraria",
    action: "Playing",
    image: "terraria.png",
    patterns: ["terraria"]
  },
  // Add more games here...
};

export class ProcessMonitor extends EventEmitter {
  constructor() {
    super();
    this.currentGame = null;
    this.gameStartTime = null;
    this.polling = false;
    this.pollInterval = null;
  }

  async start() {
    if (this.polling) return;
    this.polling = true;
    
    Log("Process monitor started");
    
    // Initial check
    await this.checkProcesses();
    
    // Poll regularly
    this.pollInterval = setInterval(() => {
      this.checkProcesses();
    }, POLL_INTERVAL);
  }

  stop() {
    this.polling = false;
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    Log("Process monitor stopped");
  }

  async checkProcesses() {
    try {
      const processes = await this.getRunningProcesses();
      const detectedGame = this.detectGame(processes);
      
      if (detectedGame && detectedGame.id !== this.currentGame?.id) {
        // New game detected!
        this.currentGame = detectedGame;
        this.gameStartTime = Date.now(); // Set start time only once
        const rpcData = this.buildRPCData(detectedGame);
        this.emit("game_detected", rpcData);
        Log(`Game detected: ${detectedGame.name}`);
      } else if (!detectedGame && this.currentGame) {
        // Game closed
        this.currentGame = null;
        this.gameStartTime = null;
        this.emit("game_closed");
        Log("Game closed");
      }
    } catch (error) {
      console.error("Error checking processes:", error);
    }
  }

  async getRunningProcesses() {
    const processes = [];
    
    try {
      // Read /proc directory
      const procDirs = await readdir("/proc");
      
      for (const dir of procDirs) {
        // Only check numeric directories (PIDs)
        if (!/^\d+$/.test(dir)) continue;
        
        try {
          // Read cmdline to get the command that started the process
          const cmdline = await readFile(`/proc/${dir}/cmdline`, "utf8");
          const cmd = cmdline.replace(/\0/g, " ").trim().toLowerCase();
          
          if (cmd) {
            // Also try to read comm (shorter process name)
            let comm = "";
            try {
              comm = await readFile(`/proc/${dir}/comm`, "utf8");
              comm = comm.trim().toLowerCase();
            } catch (e) {
              // comm might not be readable
            }
            
            processes.push({
              pid: dir,
              cmdline: cmd,
              comm: comm
            });
          }
        } catch (e) {
          // Process might have ended or we don't have permission
          continue;
        }
      }
    } catch (error) {
      console.error("Error reading /proc:", error);
    }
    
    return processes;
  }

  detectGame(processes) {
    // Check each game in our database
    for (const [gameId, gameData] of Object.entries(GAME_DATABASE)) {
      // Check if any process matches this game's patterns
      for (const process of processes) {
        const searchText = `${process.cmdline} ${process.comm}`;
        
        for (const pattern of gameData.patterns) {
          if (searchText.includes(pattern.toLowerCase())) {
            return {
              id: gameId,
              ...gameData
            };
          }
        }
      }
    }
    
    return null;
  }

  buildRPCData(game) {
    const now = Date.now();
    
    return {
      name: game.name,
      action: game.action,
      imgSrc: `${GITHUB_ASSETS_URL}/${game.image}`,
      title: game.name,
      subtitle: "Currently playing",
      startedAt: this.gameStartTime, // Use the stored start time
      updatedAt: now
    };
  }
}

function Log(...args) {
  console.log("Process Monitor>", ...args);
}
