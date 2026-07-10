import { useState, useEffect } from "react";
import { ThemeToggle } from "../theme/theme-toggle";
import { Button } from "../ui/button";
import { NavLink, useLocation } from "react-router-dom";
import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from "../ui/sheet";
import { cn } from "@/lib/utils";
import { Camera, ChevronRight, Crop, FileDown, FolderInput, FolderSync, Gauge, Globe, ImageIcon, LayoutGrid, Lock, PenLine, Pipette, Star, Tag, TextCursorInput, User, WifiOff, Zap } from "lucide-react";
import { useAuth } from "@/lib/useAuth";
import { isPaidPlan } from "@/store/useAuthStore";
import { PRICING_DISMISSED_KEY } from "./navigation";

const FAVORITES_KEY = 'conesoft_extension_favorites'

function getFavorites(): string[] {
    try { return JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]') } catch { return [] }
}

function saveFavorites(favs: string[]) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(favs))
}

// A nav item is plan-locked when it's `proOnly` and the user is on the limited tier, OR when
// it's `paidOnly` and the user isn't on a paid plan (paidOnly is stricter - it also locks
// trial). Shared by the per-item render and the group-collapse logic so they stay in sync.
function isChildLocked(child: GroupChild, isLimited: boolean, isPaid: boolean): boolean {
    return (isLimited && !!child.proOnly) || (!isPaid && !!child.paidOnly)
}

function renderChild(
    child: GroupChild,
    isLimited: boolean,
    isPaid: boolean,
    isOnline: boolean,
    favorites: string[],
    toggleFavorite: (href: string) => void,
) {
    const childLocked = isChildLocked(child, isLimited, isPaid)
    const isDisabled = child.disabled || (!isOnline && child.requiresInternet) || childLocked
    const isFav = favorites.includes(child.href)

    if (isDisabled) return (
        <div
            key={child.href}
            className="group flex items-center gap-2.5 rounded-lg p-2.5 2xl:p-3 opacity-40 cursor-not-allowed"
        >
            <div className="shrink-0 text-muted-foreground">{child.icon}</div>
            <div className="flex-1">
                <p className="text-sm 2xl:text-base font-medium leading-none mb-0.5">{child.title}</p>
                <p className="text-xs 2xl:text-sm text-muted-foreground">{child.description}</p>
            </div>
            {childLocked && <Lock className="size-4 shrink-0 text-muted-foreground" />}
            {!isOnline && child.requiresInternet && <WifiOff className="size-4 2xl:size-5 text-destructive shrink-0" />}
        </div>
    )

    return (
        <NavLink key={child.href} to={child.href}>
            {({ isActive }) => (
                <div className={cn(
                    "group flex items-center gap-2.5 rounded-lg p-2.5 2xl:p-3 transition-colors cursor-pointer",
                    isActive ? "bg-primary/10 text-primary" : "hover:bg-accent text-foreground"
                )}>
                    <div className={cn("shrink-0", isActive ? "text-primary" : "text-muted-foreground")}>{child.icon}</div>
                    <div className="flex-1">
                        <p className="text-sm 2xl:text-base font-medium leading-none mb-0.5">{child.title}</p>
                        <p className="text-xs 2xl:text-sm text-muted-foreground">{child.description}</p>
                    </div>
                    <button
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFavorite(child.href) }}
                        className={cn(
                            "shrink-0 transition-opacity cursor-pointer p-1 -m-1 rounded",
                            isFav ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                        )}
                    >
                        <Star className={cn("size-3.5", isFav ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground")} />
                    </button>
                </div>
            )}
        </NavLink>
    )
}

type GroupChild = { title: string; description: string; href: string; icon: React.ReactNode; disabled?: boolean; requiresInternet?: boolean; proOnly?: boolean; paidOnly?: boolean }
type NavGroup = { kind: 'group'; title: string; icon: React.ReactNode; children: GroupChild[] }
// A single top-level link (no children) - e.g. the PDF hub, which fans out to its tools on its
// own page rather than expanding a long list in the sidebar. Locked like a child (proOnly/paidOnly).
type NavLinkItem = { kind: 'link'; title: string; icon: React.ReactNode; href: string; activePrefix: string; proOnly?: boolean; paidOnly?: boolean }
type Extension = NavGroup | NavLinkItem

const extensions: Extension[] = [
    {
        kind: 'group',
        title: 'Image',
        icon: <ImageIcon className="size-5" />,
        children: [
            {
                title: 'Image Editor',
                description: 'Crop, transform, and adjust images',
                href: '/extensions/image-editor',
                icon: <Crop className="size-5" />,
            },
            {
                title: 'Image Compression',
                description: 'Compress images with a live before/after preview',
                href: '/extensions/image-compression',
                icon: <Zap className="size-5" />,
            },
            {
                title: 'Palette Extractor',
                description: 'Extract dominant colors from any image',
                href: '/extensions/palette-extractor',
                icon: <Pipette className="size-5" />,
            },
            {
                title: 'SVG Editor',
                description: 'Edit, optimize, and export SVGs as code or data URIs',
                href: '/extensions/svg-editor',
                icon: <PenLine className="size-5" />,
            },
            {
                title: 'Favicon Generator',
                description: 'Generate a complete icon set from one image',
                href: '/extensions/favicon',
                icon: <Globe className="size-5" />,
            },
        ],
    },
    {
        kind: 'group',
        title: 'Batch Operations',
        icon: <FolderSync className="size-5" />,
        children: [
            {
                title: 'Bulk Converter',
                description: 'Convert every image in a folder, subfolders included',
                href: '/extensions/bulk-converter',
                icon: <FolderInput className="size-5" />,
                paidOnly: true,
            },
            {
                title: 'Batch Rename',
                description: 'Rename files with patterns, prefixes, and sequences',
                href: '/extensions/batch-rename',
                icon: <TextCursorInput className="size-5" />,
                paidOnly: true,
            },
        ],
    },
    {
        kind: 'group',
        title: 'Web',
        icon: <Globe className="size-5" />,
        children: [
            {
                title: 'Screenshot',
                description: 'Capture full-page screenshots of any URL',
                href: '/extensions/website-screenshot',
                icon: <Camera className="size-5" />,
                requiresInternet: true,
                proOnly: true,
            },
            {
                title: 'Download as PDF',
                description: 'Save any webpage as a PDF',
                href: '/extensions/website-pdf',
                icon: <FileDown className="size-5" />,
                requiresInternet: true,
                proOnly: true,
            },
            {
                title: 'Lighthouse Audit',
                description: 'Audit performance, accessibility, SEO, and best practices',
                href: '/extensions/lighthouse',
                icon: <Gauge className="size-5" />,
                requiresInternet: true,
                proOnly: true,
            },
        ],
    },
    {
        kind: 'link',
        title: 'PDF',
        icon: <FileDown className="size-5" />,
        href: '/extensions/pdf',
        activePrefix: '/extensions/pdf',
        proOnly: true,
    },
]

export function NavigationSecondary() {
    const { pathname } = useLocation()
    const isExtensionActive = pathname.startsWith('/extensions')
    const { user, plan } = useAuth()
    const isLimited = plan === 'limited'
    const isPaid = isPaidPlan(plan)
    const [open, setOpen] = useState(false)
    const [favorites, setFavorites] = useState<string[]>(getFavorites)
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => {
        const initial = new Set<string>()
        if (getFavorites().length > 0) initial.add('Favorites')
        if (pathname.startsWith('/extensions/website') || pathname.startsWith('/extensions/lighthouse')) initial.add('Web')
        else if (pathname.startsWith('/extensions/bulk-converter') || pathname.startsWith('/extensions/batch-rename')) initial.add('Batch Operations')
        else if (pathname.startsWith('/extensions/image') || pathname.startsWith('/extensions/svg') || pathname.startsWith('/extensions/favicon') || pathname.startsWith('/extensions/palette')) initial.add('Image')
        return initial
    })
    const [isOnline, setIsOnline] = useState(navigator.onLine)
    const [showPricing, setShowPricing] = useState(false)

    function toggleGroup(title: string) {
        setExpandedGroups(prev => {
            const next = new Set(prev)
            next.has(title) ? next.delete(title) : next.add(title)
            return next
        })
    }

    function toggleFavorite(href: string) {
        setFavorites(prev => {
            const next = prev.includes(href) ? prev.filter(h => h !== href) : [...prev, href]
            saveFavorites(next)
            if (next.length > 0) setExpandedGroups(g => new Set(g).add('Favorites'))
            return next
        })
    }

    useEffect(() => {
        const on = () => setIsOnline(true)
        const off = () => setIsOnline(false)
        window.addEventListener('online', on)
        window.addEventListener('offline', off)

        return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
    }, [])

    useEffect(() => {
        setOpen(false)
    }, [pathname])

    useEffect(() => {
        if (open) setShowPricing(localStorage.getItem(PRICING_DISMISSED_KEY) === 'true')
    }, [open])

    return (
        <div className="flex items-center gap-x-2">
            <Sheet open={open} onOpenChange={setOpen}>
                <SheetTrigger
                    render={
                        <Button
                            variant="outline"
                            size="icon"
                            className={cn("2xl:size-10", isExtensionActive && "text-primary")}
                        />
                    }
                >
                    <LayoutGrid className="size-4 2xl:size-5" />
                    <span className="sr-only">Extensions</span>
                </SheetTrigger>
                <SheetContent side="right" className="w-94 2xl:w-108 flex flex-col">
                    <SheetHeader>
                        <SheetTitle className={'font-body 2xl:text-xl'}>Extensions</SheetTitle>
                    </SheetHeader>
                    <div className="flex flex-col gap-2 p-4 pt-0 flex-1 overflow-y-auto">
                        {/* Favorites group */}
                        {favorites.length > 0 && (() => {
                            const favChildren = extensions.flatMap(e => e.kind === 'group' ? e.children : []).filter(c => favorites.includes(c.href))
                            const isExpanded = expandedGroups.has('Favorites')
                            const isFavGroupActive = favChildren.some(c => pathname === c.href)
                            return (
                                <div key="Favorites">
                                    <button
                                        onClick={() => toggleGroup('Favorites')}
                                        className={cn(
                                            "w-full flex items-center gap-3 rounded-lg p-3 2xl:p-4 transition-colors cursor-pointer",
                                            isFavGroupActive ? "bg-primary/10 text-primary" : "hover:bg-accent text-foreground"
                                        )}
                                    >
                                        <Star className={cn("size-5 shrink-0", isFavGroupActive ? "text-primary" : "text-muted-foreground")} />
                                        <span className="text-sm 2xl:text-base font-medium flex-1 text-left">Favorites</span>
                                        <ChevronRight className={cn("size-4 2xl:size-5 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
                                    </button>
                                    {isExpanded && (
                                        <div className="ml-4 mt-1 flex flex-col gap-1 border-l border-border pl-3">
                                            {favChildren.map(child => renderChild(child, isLimited, isPaid, isOnline, favorites, toggleFavorite))}
                                        </div>
                                    )}
                                </div>
                            )
                        })()}

                        {extensions.map((ext) => {
                            // Single-link entry (e.g. PDF hub): one row that navigates, no expansion.
                            if (ext.kind === 'link') {
                                const locked = (isLimited && !!ext.proOnly) || (!isPaid && !!ext.paidOnly)
                                const active = !locked && pathname.startsWith(ext.activePrefix)
                                if (locked) return (
                                    <div key={ext.title} className="w-full flex items-center gap-3 rounded-lg p-3 2xl:p-4 opacity-50 cursor-not-allowed">
                                        <div className="shrink-0 text-muted-foreground">{ext.icon}</div>
                                        <span className="text-sm 2xl:text-base font-medium flex-1 text-left">{ext.title}</span>
                                        <Lock className="size-4 shrink-0 text-muted-foreground" />
                                    </div>
                                )
                                return (
                                    <NavLink
                                        key={ext.title}
                                        to={ext.href}
                                        className={cn(
                                            "w-full flex items-center gap-3 rounded-lg p-3 2xl:p-4 transition-colors cursor-pointer",
                                            active ? "bg-primary/10 text-primary" : "hover:bg-accent text-foreground"
                                        )}
                                    >
                                        <div className={cn("shrink-0", active ? "text-primary" : "text-muted-foreground")}>{ext.icon}</div>
                                        <span className="text-sm 2xl:text-base font-medium flex-1 text-left">{ext.title}</span>
                                        <ChevronRight className="size-4 2xl:size-5 text-muted-foreground" />
                                    </NavLink>
                                )
                            }

                            const visibleChildren = ext.children.filter(c => !favorites.includes(c.href))
                            if (visibleChildren.length === 0) return null
                            const groupLocked = visibleChildren.every(c => isChildLocked(c, isLimited, isPaid))
                            const isExpanded = expandedGroups.has(ext.title) && !groupLocked
                            const isGroupActive = !groupLocked && visibleChildren.some(c => pathname === c.href)

                            return (
                                <div key={ext.title}>
                                    <button
                                        onClick={() => !groupLocked && toggleGroup(ext.title)}
                                        className={cn(
                                            "w-full flex items-center gap-3 rounded-lg p-3 2xl:p-4 transition-colors",
                                            groupLocked ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
                                            !groupLocked && (isGroupActive ? "bg-primary/10 text-primary" : "hover:bg-accent text-foreground")
                                        )}
                                    >
                                        <div className={cn("shrink-0", isGroupActive ? "text-primary" : "text-muted-foreground")}>
                                            {ext.icon}
                                        </div>
                                        <span className="text-sm 2xl:text-base font-medium flex-1 text-left">{ext.title}</span>
                                        {groupLocked
                                            ? <Lock className="size-4 shrink-0 text-muted-foreground" />
                                            : <ChevronRight className={cn("size-4 2xl:size-5 text-muted-foreground transition-transform", isExpanded && "rotate-90")} />
                                        }
                                    </button>
                                    {isExpanded && (
                                        <div className="ml-4 mt-1 flex flex-col gap-1 border-l border-border pl-3">
                                            {visibleChildren.map(child => renderChild(child, isLimited, isPaid, isOnline, favorites, toggleFavorite))}
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                    <div className="p-4 border-t border-border flex flex-col gap-y-2">
                        {showPricing &&
                            <NavLink to={'/pricing'}>
                                {({ isActive }) => (
                                    <div className={cn(
                                        "flex items-center gap-2.5 rounded-lg p-2.5 2xl:p-3 transition-colors cursor-pointer",
                                        isActive ? "bg-primary/10 text-primary" : "hover:bg-accent text-foreground"
                                    )}>
                                        <Tag className={cn("size-5 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                                        <div>
                                            <p className="text-sm 2xl:text-base font-medium leading-none mb-0.5">Pricing</p>
                                        </div>
                                    </div>
                                )}
                            </NavLink>
                        }
                        <NavLink to="/account">
                            {({ isActive }) => (
                                <div className={cn(
                                    "flex items-center gap-3 rounded-lg p-3 2xl:p-4 transition-colors cursor-pointer",
                                    isActive ? "bg-primary/10 text-primary" : "hover:bg-accent text-foreground"
                                )}>
                                    <User className={cn("size-5 2xl:size-6 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                                    <div>
                                        <p className="text-sm 2xl:text-base font-medium leading-none mb-1">Account</p>
                                        <p className="text-xs 2xl:text-sm text-muted-foreground">
                                            {user ? user.email : 'Sign in or create an account'}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </NavLink>
                    </div>
                </SheetContent>
            </Sheet>

            <ThemeToggle />
        </div>
    )
}
