import type {Metadata} from 'next';
export const metadata:Metadata={title:'Skybound Sprint',description:'Vertical parkour puzzles and shared speedrun times.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>;}
