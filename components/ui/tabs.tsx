"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { spring } from "@/lib/client/workspace-motion"
import { MotionDisclosure } from "@/components/ui/workspace-motion"

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "group/tabs flex gap-2 data-[orientation=horizontal]:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  children,
  ref,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  const list = React.useRef<HTMLDivElement>(null)
  const marker = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    const element = list.current, indicator = marker.current
    if (!element || !indicator) return
    let stopStart: (() => void) | undefined, stopEnd: (() => void) | undefined
    let start = 0, end = 0, initialized = false
    const startMotion = { value: 0, velocity: 0 }, endMotion = { value: 0, velocity: 0 }
    const update = () => {
      const active = element.querySelector<HTMLElement>('[data-slot="tabs-trigger"][data-state="active"]')
      if (!active) { indicator.style.visibility = "hidden"; return }
      const vertical = element.getAttribute("aria-orientation") === "vertical"
      const nextStart = vertical ? active.offsetTop : active.offsetLeft
      const nextEnd = nextStart + (vertical ? active.offsetHeight : active.offsetWidth)
      const draw = () => {
        indicator.style.setProperty("--tab-start", `${start}px`)
        indicator.style.setProperty("--tab-size", `${Math.max(0, end - start)}px`)
      }
      stopStart?.(); stopEnd?.()
      indicator.style.visibility = "visible"
      element.dataset.motionReady = "true"
      if (!initialized) { start = nextStart; end = nextEnd; initialized = true; draw() }
      else {
        stopStart = spring(start, nextStart, value => { start = value; draw() }, undefined, 35, startMotion)
        stopEnd = spring(end, nextEnd, value => { end = value; draw() }, undefined, 25, endMotion)
      }
    }
    update()
    const mutations = new MutationObserver(update)
    mutations.observe(element, { subtree: true, attributes: true, attributeFilter: ["data-state", "aria-orientation"], childList: true, characterData: true })
    const resize = new ResizeObserver(update)
    resize.observe(element)
    return () => { mutations.disconnect(); resize.disconnect(); stopStart?.(); stopEnd?.() }
  }, [])
  return (
    <TabsPrimitive.List
      ref={node => { list.current = node; if (typeof ref === "function") ref(node); else if (ref) ref.current = node }}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    >
      <span ref={marker} className="tabs-motion-indicator" aria-hidden="true" />
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent",
        "data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground",
        "after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  children,
  forceMount,
  hidden,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      forceMount={forceMount}
      hidden={forceMount ? undefined : hidden}
      aria-hidden={forceMount ? hidden : undefined}
      tabIndex={forceMount && hidden ? -1 : undefined}
      inert={forceMount && hidden ? true : undefined}
      {...props}
    >
      {forceMount && typeof hidden === "boolean" ? <MotionDisclosure open={!hidden}>{children}</MotionDisclosure> : children}
    </TabsPrimitive.Content>
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
