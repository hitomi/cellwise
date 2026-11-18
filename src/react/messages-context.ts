import { createContext, useContext } from 'react'
import { en, type Messages } from '../core/messages.js'

/** Messages of the table being rendered; cells and editors read them here. */
export const MessagesContext = createContext<Messages>(en)

export const useMessages = () => useContext(MessagesContext)
