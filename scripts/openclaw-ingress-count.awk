{
  row = tolower($0)
  name = tolower($1)
  if (name == "npm" || row ~ /(frpc|nginx-proxy-manager|nginxproxymanager)/) {
    count++
  }
}

END {
  print count + 0
}
