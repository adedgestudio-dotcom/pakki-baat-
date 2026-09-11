import type { MetadataRoute } from "next";
export default function manifest():MetadataRoute.Manifest{return {name:"Pakki Baat",short_name:"Pakki Baat",description:"Your little business assistant",start_url:"/",display:"standalone",background_color:"#fafbf7",theme_color:"#176e61",icons:[{src:"/icon.svg",sizes:"any",type:"image/svg+xml",purpose:"any"}]};}
