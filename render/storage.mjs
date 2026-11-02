import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
/** Disposable single-process SQLite adapter. Production SQL is unchanged. */
export class NodeDatabase {
 constructor(file=':memory:'){
  this.sqlite=new DatabaseSync(file);
  try{
   this.sqlite.exec('PRAGMA foreign_keys=ON; CREATE TABLE IF NOT EXISTS render_migrations (name TEXT PRIMARY KEY)');
   const directory=new URL('../server/drizzle/',import.meta.url);
   for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort()){
    if(this.sqlite.prepare('SELECT name FROM render_migrations WHERE name=?').get(name))continue;
    this.sqlite.exec('BEGIN IMMEDIATE');
    try{this.sqlite.exec(readFileSync(new URL(name,directory),'utf8'));this.sqlite.prepare('INSERT INTO render_migrations(name) VALUES(?)').run(name);this.sqlite.exec('COMMIT');}
    catch(error){this.sqlite.exec('ROLLBACK');throw error;}
   }
  }catch(error){this.sqlite.close();throw error;}
 }
 prepare(sql){return new Statement(this,sql,[]);}
 async batch(statements){if(!Array.isArray(statements)||statements.some(s=>!(s instanceof Statement)||s.db!==this))throw Error('Invalid batch statement owner');this.sqlite.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>s.execute());this.sqlite.exec('COMMIT');return results;}catch(error){this.sqlite.exec('ROLLBACK');throw error;}}
 close(){this.sqlite.close();}
}
class Statement{
 constructor(db,sql,values){this.db=db;this.sql=sql;this.values=values;}
 bind(...values){return new Statement(this.db,this.sql,values);}
 execute(){const s=this.db.sqlite.prepare(this.sql);if(s.columns().length)return {success:true,results:s.all(...this.values).map(r=>({...r})),meta:{}};const r=s.run(...this.values);return{success:true,results:[],meta:{changes:Number(r.changes),last_row_id:Number(r.lastInsertRowid)}};}
 async first(column){const row=this.execute().results[0]??null;return column&&row?row[column]:row;}
 async all(){return this.execute();}async run(){return this.execute();}
}
