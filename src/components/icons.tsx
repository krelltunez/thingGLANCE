import {
  AppWindow, Box, Cable, CalendarX, Camera, CircleArrowUp, Gamepad2, HardDrive, Headphones, Hourglass,
  Laptop, LifeBuoy, Lightbulb, Monitor, PcCase, Printer, Repeat, Router, ShieldCheck, Smartphone, Tablet,
  Tv, Watch, type LucideIcon,
} from 'lucide-react'
import type { CategoryId, EventType } from '@/core/types'
import { category } from '@/core/categories'

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Smartphone, Laptop, PcCase, Tablet, Watch, Headphones, Tv, Monitor, Gamepad2, Camera, Router, HardDrive,
  Lightbulb, Printer, Cable, AppWindow, Box,
}

export const categoryIcon = (id: CategoryId | undefined): LucideIcon => CATEGORY_ICONS[category(id).icon] ?? Box

export const EVENT_ICONS: Record<EventType, LucideIcon> = {
  'coverage-end': ShieldCheck,
  'support-end': LifeBuoy,
  replace: CircleArrowUp,
  renewal: Repeat,
  'trial-end': Hourglass,
  'sub-end': CalendarX,
}
