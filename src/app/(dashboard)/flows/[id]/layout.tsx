/**
 * Flow editor + runs share this layout so the canvas can fill the
 * dashboard content area. Negative margin cancels the shell's page
 * padding; the editor chrome (toolbar, stage, validation bar) owns
 * its own inset.
 */
export default function FlowIdLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="-m-4 flex h-[calc(100%+2rem)] min-h-0 flex-1 flex-col sm:-m-6 sm:h-[calc(100%+3rem)]">
      {children}
    </div>
  );
}
