Option Explicit

If WScript.Arguments.Count <> 1 Then WScript.Quit 2

Dim fileSystem, nodePath, packageDirectory, launcherPath, shell, command, exitCode
Set fileSystem = CreateObject("Scripting.FileSystemObject")
nodePath = WScript.Arguments(0)
packageDirectory = fileSystem.GetParentFolderName(fileSystem.GetParentFolderName(WScript.ScriptFullName))
launcherPath = fileSystem.BuildPath(fileSystem.GetParentFolderName(WScript.ScriptFullName), "start-background.mjs")

If Not fileSystem.FileExists(nodePath) Then WScript.Quit 2
If Not fileSystem.FileExists(launcherPath) Then WScript.Quit 2

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = packageDirectory
command = Chr(34) & nodePath & Chr(34) & " " & Chr(34) & launcherPath & Chr(34)
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode
