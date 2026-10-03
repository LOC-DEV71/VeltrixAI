import {randomBytes,scryptSync,timingSafeEqual} from 'node:crypto';
import {hashSecret} from './crypto';
export function hashAdminPassword(password:string){const salt=randomBytes(16).toString('hex');return `scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`;}
export function verifyAdminPassword(password:string,stored:string){
  if(typeof password!=='string'||password.length>128||typeof stored!=='string')return false;
  const pieces=stored.split(':');
  if(pieces[0]==='scrypt'&&pieces.length===3&&/^[a-f0-9]{32}$/.test(pieces[1])&&/^[a-f0-9]{128}$/.test(pieces[2]))return timingSafeEqual(scryptSync(password,pieces[1],64),Buffer.from(pieces[2],'hex'));
  if(!/^[a-f0-9]{64}$/.test(stored))return false;
  return timingSafeEqual(Buffer.from(hashSecret(password),'hex'),Buffer.from(stored,'hex'));
}
