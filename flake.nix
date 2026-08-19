{
 description = "Nrerimity for Nix!";
 

  outputs = { self, nixpkgs,  }:
     let
       
       allSystems = [
         "x86_64-linux" # 64-bit Intel/AMD Linux
         "aarch64-linux" # 64-bit ARM Linux
         "aarch64-darwin" # 64-bit ARM macOS
       ];
 
       # Helper to provide system-specific attributes
       forAllSystems =
         f:
         nixpkgs.lib.genAttrs allSystems (
           system:
           f {
             pkgs = import nixpkgs { inherit system; };
           }
         );
     in{
  packages = forAllSystems ({ pkgs }: {
    default = pkgs.buildNpmPackage {
      name = "nerimty";
      version = "v2.2.0";
      

      src = ./.;
      dontNpmBuild = true;
      npmDepsHash = "sha256-WgGY8LMT72WTY0bYF3Bymn9N1KqNunx7UOa62kShoD4=";
      npmDeps = pkgs.importNpmLock {
        npmRoot = ./.;
      };
      nativeBuildInputs = [
        pkgs.copyDesktopItems
      ];
      buildInputs = [ pkgs.libxtst pkgs.libx11 pkgs.libxrandr.dev pkgs.libxt.dev];
      
      npmConfigHook = pkgs.importNpmLock.npmConfigHook;
     
    
     
      env = {
        ELECTRON_SKIP_BINARY_DOWNLOAD = 1;
      };
      
      postPatch = ''
         #   substituteInPlace src/utils.js \
         #       --replace "execFile !== \"electron\";" "true"
            substituteInPlace src/main.js \
                --replace "openUpdaterWindow();" "openMainWindow();"
      '';
    
      desktopItems = [
          (pkgs.makeDesktopItem {
            name = "nerimity";
            exec = "nerimity";
            icon = "nermityicon";
            desktopName = "Nermity";
          })
        ];
        
      
         
      postInstall = ''
        makeWrapper ${pkgs.electron}/bin/nerimity $out/bin/nerimity \
          --add-flags $out/lib/node_modules/nerimity-desktop/src/main.js
        install -D build/icon-512.png $out/share/icons/hicolor/512x512/apps/nermityicon.png
      '';
     
    };
  });
 };
}
