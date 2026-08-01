import {
  createComponent,
  createContext,
  createMemo,
  Show,
  useContext,
  type Accessor,
  type Component,
  type JSX,
  type ParentProps,
} from "solid-js"

type ShowProps = {
  when: boolean | null | undefined
  fallback?: JSX.Element
  children: JSX.Element
}
const ShowComponent = Show as Component<ShowProps>

export function createSimpleContext<T, Props extends Record<string, any>>(
  input: {
    name: string
    init: ((input: Props) => T) | (() => T)
  } & (T extends { ready: unknown } ? { gate: boolean } : { gate?: boolean }),
) {
  const ctx = createContext<T>()

  return {
    provider: (props: ParentProps<Props>) => {
      const init = input.init(props)
      const gate = input.gate ?? true

      if (!gate) {
        return createComponent(ctx.Provider, {
          value: init,
          get children() {
            return props.children
          },
        })
      }

      // Access init.ready inside the memo to make it reactive for getter properties
      const isReady = createMemo(() => {
        // @ts-expect-error
        const ready = init.ready as Accessor<boolean> | boolean | undefined
        return ready === undefined || (typeof ready === "function" ? ready() : ready)
      })
      return createComponent(ShowComponent, {
        get when() {
          return isReady()
        },
        get children() {
          return createComponent(ctx.Provider, {
            value: init,
            get children() {
              return props.children
            },
          })
        },
      })
    },
    use() {
      const value = useContext(ctx)
      if (!value) throw new Error(`${input.name} context must be used within a context provider`)
      return value
    },
  }
}
