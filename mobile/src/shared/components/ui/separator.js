"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import * as React from "react";
import { Separator as SeparatorPrimitive } from "radix-ui";
import { cn } from "../../lib/utils.js";
function Separator({ className, orientation = "horizontal", decorative = true, ...props }) {
    return (_jsx(SeparatorPrimitive.Root, { "data-slot": "separator", decorative: decorative, orientation: orientation, className: cn("shrink-0 bg-border data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px", className), ...props }));
}
export { Separator };
