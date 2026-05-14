import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://yvwpesvjfdofsxvtooha.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl2d3Blc3ZqZmRvZnN4dnRvb2hhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0MzI5NTEsImV4cCI6MjA5NDAwODk1MX0.aJFnTXuOqVmFVkMvuTdQls8gYkG6W9RXK-3kRKMK_RU'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)