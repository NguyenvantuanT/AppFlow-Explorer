package com.example.tasky.ui

import android.content.Intent
import android.os.Bundle
import android.view.View
import androidx.fragment.app.Fragment
import androidx.navigation.fragment.findNavController
import com.example.tasky.LegacyHelpActivity
import com.example.tasky.R
import com.example.tasky.databinding.FragmentTaskListBinding

class TaskListFragment : Fragment(R.layout.fragment_task_list) {

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val binding = FragmentTaskListBinding.bind(view)
        binding.taskRow.setOnClickListener {
            findNavController().navigate(R.id.action_taskList_to_taskDetail)
        }
        binding.fabAdd.setOnClickListener {
            findNavController().navigate(TaskListFragmentDirections.actionTaskListToEditTask())
        }
        binding.btnHelp.setOnClickListener {
            startActivity(Intent(requireContext(), LegacyHelpActivity::class.java))
        }
    }
}
