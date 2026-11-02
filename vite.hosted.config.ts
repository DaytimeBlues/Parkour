import {defineConfig} from 'vite';
export default defineConfig({base:'/game/',publicDir:false,build:{outDir:'.game-build',emptyOutDir:true,rollupOptions:{input:['index.html','multiplayer/index.html']}}});
