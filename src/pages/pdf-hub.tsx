import { NavLink } from 'react-router-dom'
import { FileEdit, FilePlus, FileImage, Images, Scissors, Minimize2, Hash, Heading, PenTool, Crop, Flame, ArrowRight } from 'lucide-react'

type Tool = {
  title: string
  description: string
  href: string
  icon: React.ReactNode
  soon?: boolean
  popular?: boolean
}

// Ordered so each row of 3 (lg grid) is one kind:
// row 1 = Organize, row 2 = Convert & Optimize, row 3 = Edit & Sign.
const TOOLS: Tool[] = [
  // — Organize —
  {
    title: 'Merge',
    description: 'Combine multiple PDFs into one, in any order.',
    href: '/extensions/pdf-merge',
    icon: <FilePlus className="size-6" />,
    popular: true,
  },
  {
    title: 'Split & Extract',
    description: 'Pull selected pages into a new PDF, or split each into its own file.',
    href: '/extensions/pdf-split',
    icon: <Scissors className="size-6" />,
  },
  {
    title: 'PDF Editor',
    description: 'Reorder, rotate, annotate, watermark, and fill forms.',
    href: '/extensions/pdf-editor',
    icon: <FileEdit className="size-6" />,
  },
  // — Convert & Optimize —
  {
    title: 'Images to PDF',
    description: 'Combine images into a single PDF, one per page.',
    href: '/extensions/images-to-pdf',
    icon: <FileImage className="size-6" />,
  },
  {
    title: 'PDF to Images',
    description: 'Export every page as a PNG, JPG, or WebP image.',
    href: '/extensions/pdf-to-images',
    icon: <Images className="size-6" />,
  },
  {
    title: 'Compress',
    description: 'Shrink PDF file size by recompressing images and structure.',
    href: '/extensions/pdf-compress',
    icon: <Minimize2 className="size-6" />,
    popular: true,
  },
  // — Edit & Sign —
  {
    title: 'Sign',
    description: 'Draw or upload a signature and place it on the page.',
    href: '/extensions/pdf-sign',
    icon: <PenTool className="size-6" />,
    popular: true,
  },
  {
    title: 'Page Numbers',
    description: 'Add page numbers with control over position and format.',
    href: '/extensions/pdf-page-numbers',
    icon: <Hash className="size-6" />,
  },
  {
    title: 'Header & Footer',
    description: 'Add header and footer text, with page and date placeholders.',
    href: '/extensions/pdf-header-footer',
    icon: <Heading className="size-6" />,
  },
  {
    title: 'Crop',
    description: 'Trim margins or select an area to keep, on one page or all.',
    href: '/extensions/pdf-crop',
    icon: <Crop className="size-6" />,
  },
]

export default function PdfHub() {
  return (
    <section className="section py-8">
      <div className="mb-6 lg:mb-8">
        <h2 className="text-2xl xl:text-3xl font-body font-semibold text-foreground">PDF Tools</h2>
        <p className="text-sm xl:text-base text-muted-foreground mt-1">
          Edit, convert, split, and merge PDFs.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
        {TOOLS.map(tool => {
          if (tool.soon) {
            return (
              <div
                key={tool.href}
                className="relative rounded-xl border border-border bg-secondary/20 p-5 lg:p-6 flex flex-col gap-3 lg:gap-4 opacity-60 cursor-not-allowed"
              >
                <span className="absolute top-3 right-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground border border-border rounded-full px-2 py-0.5">
                  Soon
                </span>
                <div className="size-11 xl:size-12 rounded-lg bg-muted text-muted-foreground flex items-center justify-center shrink-0">
                  {tool.icon}
                </div>
                <div>
                  <h3 className="text-sm xl:text-base font-body font-medium text-foreground">{tool.title}</h3>
                  <p className="text-xs xl:text-sm text-muted-foreground mt-1">{tool.description}</p>
                </div>
              </div>
            )
          }
          return (
            <NavLink
              key={tool.href}
              to={tool.href}
              className="group relative rounded-xl border border-border bg-secondary/30 p-5 lg:p-6 flex flex-col gap-3 lg:gap-4 hover:border-primary/50 transition-colors"
            >
              <ArrowRight className="absolute top-4 right-4 size-4 text-muted-foreground opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
              <div className="size-11 xl:size-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                {tool.icon}
              </div>
              <div>
                <div className="flex items-center gap-1.5">
                  <h3 className="text-sm xl:text-base font-body font-medium text-foreground">{tool.title}</h3>
                  {tool.popular && <Flame className="size-4 text-orange-500 shrink-0 animate-flame-glow" aria-label="Popular" />}
                </div>
                <p className="text-xs xl:text-sm text-muted-foreground mt-1">{tool.description}</p>
              </div>
            </NavLink>
          )
        })}
      </div>
    </section>
  )
}
