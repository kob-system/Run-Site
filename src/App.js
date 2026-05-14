const fetchProjects = async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) console.log('Fetch error:', error)
    setProjects(data || [])
  }