import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

const GA_ID='G-HW6MDZLN6Z';
const s=document.createElement('script');
s.async=true;
s.src=`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
document.head.appendChild(s);
const w=window as unknown as {dataLayer:unknown[];gtag?:(...args:unknown[])=>void};
w.dataLayer=w.dataLayer||[];
w.gtag=(...args:unknown[])=>{w.dataLayer.push(args)};
w.gtag('js',new Date());
w.gtag('config',GA_ID);

createApp(App).mount('#app');
