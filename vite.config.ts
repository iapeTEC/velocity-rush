import { defineConfig } from 'vite';
export default defineConfig({base:'./',build:{target:'es2022',rollupOptions:{output:{manualChunks:{three:['three'],physics:['cannon-es'],firebase:['firebase/app','firebase/auth','firebase/database']}}}}});
