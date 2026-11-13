import { handleNoteAssistant } from './handler.ts'

Deno.serve(request => handleNoteAssistant(request, name => Deno.env.get(name)))
