// Curated Lucide icons the storyboard may name (kebab-case). Unknown names fall back to "sparkles".
import * as L from 'lucide-react';
import React from 'react';

const MAP = {
  rocket: L.Rocket, globe: L.Globe, earth: L.Earth, zap: L.Zap, sun: L.Sun, moon: L.Moon, star: L.Star, atom: L.Atom,
  brain: L.Brain, cpu: L.Cpu, heart: L.Heart, flame: L.Flame, droplet: L.Droplet, leaf: L.Leaf, 'tree-pine': L.TreePine,
  mountain: L.Mountain, telescope: L.Telescope, orbit: L.Orbit, satellite: L.Satellite, sparkles: L.Sparkles,
  lightbulb: L.Lightbulb, 'book-open': L.BookOpen, 'graduation-cap': L.GraduationCap, 'dollar-sign': L.DollarSign,
  coins: L.Coins, 'trending-up': L.TrendingUp, 'trending-down': L.TrendingDown, 'chart-column': L.ChartColumn,
  clock: L.Clock, calendar: L.Calendar, hourglass: L.Hourglass, map: L.Map, 'map-pin': L.MapPin, compass: L.Compass,
  users: L.Users, user: L.User, baby: L.Baby, skull: L.Skull, shield: L.Shield, lock: L.Lock, eye: L.Eye,
  camera: L.Camera, music: L.Music, film: L.Film, gamepad: L.Gamepad2, trophy: L.Trophy, target: L.Target, flag: L.Flag,
  crown: L.Crown, gem: L.Gem, gift: L.Gift, 'shopping-cart': L.ShoppingCart, car: L.Car, plane: L.Plane, ship: L.Ship,
  train: L.TrainFront, house: L.House, building: L.Building2, factory: L.Factory, wifi: L.Wifi, smartphone: L.Smartphone,
  laptop: L.Laptop, bot: L.Bot, dna: L.Dna, microscope: L.Microscope, flask: L.FlaskConical, pill: L.Pill,
  stethoscope: L.Stethoscope, activity: L.Activity, thermometer: L.Thermometer, wind: L.Wind, cloud: L.Cloud,
  'cloud-rain': L.CloudRain, snowflake: L.Snowflake, waves: L.Waves, fish: L.Fish, bird: L.Bird, cat: L.Cat, dog: L.Dog,
  bug: L.Bug, apple: L.Apple, coffee: L.Coffee, utensils: L.Utensils, 'thumbs-up': L.ThumbsUp, bell: L.Bell, play: L.Play,
  'message-circle': L.MessageCircle, share: L.Share2, alert: L.TriangleAlert, help: L.CircleHelp, check: L.Check, x: L.X,
  infinity: L.Infinity, scale: L.Scale, swords: L.Swords, handshake: L.Handshake, megaphone: L.Megaphone, search: L.Search,
  key: L.Key, battery: L.BatteryCharging, plug: L.Plug, radiation: L.Radiation, landmark: L.Landmark, scroll: L.Scroll,
  pyramid: L.Pyramid, sword: L.Sword, ghost: L.Ghost, tornado: L.Tornado, gauge: L.Gauge, ruler: L.Ruler, layers: L.Layers,
  network: L.Network, server: L.Server, database: L.Database, code: L.Code, 'piggy-bank': L.PiggyBank, wallet: L.Wallet,
  banknote: L.Banknote, medal: L.Medal, dumbbell: L.Dumbbell, bike: L.Bike, footprints: L.Footprints, hand: L.Hand,
  smile: L.Smile, frown: L.Frown,
} satisfies Record<string, React.ComponentType<L.LucideProps>>;

export type IconName = keyof typeof MAP;
export const ICON_NAMES = Object.keys(MAP) as IconName[];

export const Icon: React.FC<{ name: string; size: number; color: string; strokeWidth?: number; style?: React.CSSProperties }> = ({ name, size, color, strokeWidth = 2, style }) => {
  const Component = MAP[(name in MAP ? name : 'sparkles') as IconName];
  return <Component size={size} color={color} strokeWidth={strokeWidth} absoluteStrokeWidth={false} style={style} />;
};
